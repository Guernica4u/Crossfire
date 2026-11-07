#!/usr/bin/env node
import { createServer, request as httpRequest } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL_DIR = join(ROOT, "control-panel");
const DATA_DIR = join(ROOT, "data", "control-panel");
const ENV_FILE = join(ROOT, ".env.local");
const APP_LOG = join(DATA_DIR, "app.log");
const PANEL_LOG = join(DATA_DIR, "panel.log");
const STATE_FILE = join(DATA_DIR, "state.json");
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const APP_PORT = 3000;
const APP_ORIGIN = "http://localhost:3000";
const APP_HEALTH = "http://127.0.0.1:3000";
const PORT = Number(process.env.CROSSFIRE_CONTROL_PORT || 4310);
const HOST = "127.0.0.1";
const NO_OPEN = process.env.CROSSFIRE_CONTROL_NO_OPEN === "1" || process.argv.includes("--no-open");
const OPEN_ON_START = process.argv.includes("--open");
const SESSION_TOKEN = randomBytes(32).toString("hex");
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const DEFAULT_PREFS = { autoStart: true, autoOpen: false };

mkdirSync(DATA_DIR, { recursive: true });
rotate(PANEL_LOG, 1_000_000);

function rotate(file, limit) {
  try {
    if (existsSync(file) && statSync(file).size > limit) writeFileSync(file, "");
  } catch {}
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    appendFileSync(PANEL_LOG, `${line}\n`);
  } catch {}
  try {
    console.log(line);
  } catch {}
}

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { appPid: parsed.appPid ?? null, prefs: { ...DEFAULT_PREFS, ...(parsed.prefs ?? {}) } };
  } catch {
    return { appPid: null, prefs: { ...DEFAULT_PREFS } };
  }
}

const state = loadState();
let appChild = null;
let appPid = null;
let starting = false;
let stopping = false;
let lastError = null;
let providerCache = { at: 0, value: null };

function saveState() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ appPid: state.appPid, prefs: state.prefs }, null, 2));
  } catch (error) {
    log(`Could not save state: ${error.message}`);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function normalizeKey(value) {
  let key = String(value ?? "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

function extractKey(text) {
  const match = text.match(/^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/m);
  return match ? normalizeKey(match[1]) : "";
}

function readKeyInfo() {
  for (const [file, source] of [
    [ENV_FILE, "file"],
    [join(ROOT, ".env"), "dotenv"],
  ]) {
    if (!existsSync(file)) continue;
    const key = extractKey(readFileSync(file, "utf8"));
    if (key) return { key, source };
  }
  const envKey = normalizeKey(process.env.OPENROUTER_API_KEY);
  return envKey ? { key: envKey, source: "environment" } : { key: null, source: null };
}

function isValidKey(key) {
  return /^sk-[A-Za-z0-9._-]{16,}$/.test(key);
}

function keyHint(key) {
  return `sk-or-…${key.slice(-4)}`;
}

function writeKey(key) {
  let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=/.test(line));
  if (index >= 0) lines[index] = `OPENROUTER_API_KEY=${key}`;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`OPENROUTER_API_KEY=${key}`);
  }
  content = lines.join("\n");
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(ENV_FILE, content, { encoding: "utf8", mode: 0o600 });
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 4) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function commandLineFor(pid) {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: "utf8", timeout: 5000 },
      ).trim();
    }
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return "";
  }
}

function listenerPid(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        if (!(parts[1] || "").endsWith(`:${port}`)) continue;
        const pid = Number(parts[parts.length - 1]);
        if (Number.isInteger(pid) && pid > 4) return pid;
      }
      return null;
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    const pid = Number(out.trim().split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 4 ? pid : null;
  } catch {
    return null;
  }
}

function readLock() {
  try {
    return JSON.parse(readFileSync(join(ROOT, ".next", "dev", "lock"), "utf8"));
  } catch {
    return null;
  }
}

function findAppPid() {
  const lock = readLock();
  const candidates = [lock?.pid, listenerPid(APP_PORT), state.appPid].filter(Boolean);
  for (const pid of [...new Set(candidates)]) {
    if (!isPidAlive(pid)) continue;
    const command = commandLineFor(pid).toLowerCase();
    if (!command || command.includes("next")) return pid;
  }
  return null;
}

function isPortOpen(port) {
  return new Promise((done) => {
    const socket = connect({ host: HOST, port });
    const finish = (value) => {
      socket.destroy();
      done(value);
    };
    socket.setTimeout(700);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function isAppReady() {
  try {
    const response = await fetch(`${APP_HEALTH}/`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function getAppStatus(force = false) {
  if (!force && Date.now() - providerCache.at < 30_000) {
    return providerCache.value;
  }
  let value;
  try {
    const response = await fetch(`${APP_HEALTH}/api/provider/status`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!response.ok) value = { running: false, error: `App returned ${response.status}.` };
    else value = { running: true, provider: await response.json() };
  } catch {
    value = { running: false };
  }
  providerCache = { at: Date.now(), value };
  return value;
}

function tailLog(file, lines) {
  try {
    if (!existsSync(file)) return "No server log yet.";
    const text = readFileSync(file, "utf8").replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
    return text.split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "Could not read the log.";
  }
}

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitForApp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAppReady()) return true;
    if (appChild && appChild.exitCode !== null) return false;
    await delay(600);
  }
  return false;
}

async function waitForPortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true;
    await delay(400);
  }
  return false;
}

function openUrl(url) {
  if (NO_OPEN) {
    log(`Would open ${url}`);
    return;
  }
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => log(`Could not open ${url}`));
    child.unref();
  } catch {
    log(`Could not open ${url}`);
  }
}

function openPath(path) {
  if (NO_OPEN) {
    log(`Would open folder ${path}`);
    return;
  }
  const [command, args] =
    process.platform === "win32"
      ? ["explorer.exe", [path]]
      : process.platform === "darwin"
        ? ["open", [path]]
        : ["xdg-open", [path]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    log(`Could not open folder ${path}`);
  }
}

function runLogged(command, args, shell = false) {
  return new Promise((done, reject) => {
    const fd = openSync(APP_LOG, "a");
    let closed = false;
    const closeFd = () => {
      if (closed) return;
      closed = true;
      try {
        closeSync(fd);
      } catch {}
    };
    const child = spawn(command, args, {
      cwd: ROOT,
      windowsHide: true,
      shell,
      stdio: ["ignore", fd, fd],
    });
    child.on("error", (error) => {
      closeFd();
      reject(new HttpError(500, `Could not run ${command}: ${error.message}`));
    });
    child.on("exit", (code) => {
      closeFd();
      if (code === 0) done();
      else reject(new HttpError(500, `${command} exited with code ${code}. Check the server log.`));
    });
  });
}

async function ensureDeps() {
  if (existsSync(join(ROOT, "node_modules", "next", "package.json"))) return;
  log("Installing dependencies.");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await runLogged(npm, ["install"], process.platform === "win32");
}

function ensureNode() {
  if (Number(process.versions.node.split(".")[0]) < 24) {
    fail(500, `Node.js 24 or newer is required. This panel is running on ${process.versions.node}.`);
  }
}

async function startApp({ open = false } = {}) {
  if (starting) fail(409, "Crossfire is already starting.");
  if (await isPortOpen(APP_PORT)) {
    const status = await getAppStatus(true);
    if (status.running) {
      if (open) openUrl(APP_ORIGIN);
      return { already: true };
    }
    fail(409, "Port 3000 is already in use by another program.");
  }
  const keyInfo = readKeyInfo();
  if (!keyInfo.key) fail(400, "Add an OpenRouter key below first.");
  if (keyInfo.source === "environment") {
    writeKey(keyInfo.key);
    log("Copied the environment key into .env.local.");
  }
  starting = true;
  try {
    ensureNode();
    await ensureDeps();
    if (await isPortOpen(APP_PORT)) fail(409, "Port 3000 is already in use by another program.");
    rotate(APP_LOG, 2_000_000);
    appendFileSync(APP_LOG, `\n=== Crossfire start ${new Date().toISOString()} ===\n`);
    const fd = openSync(APP_LOG, "a");
    const env = { ...process.env, PORT: String(APP_PORT) };
    delete env.OPENROUTER_API_KEY;
    const child = spawn(process.execPath, [NEXT_BIN, "dev", "-p", String(APP_PORT)], {
      cwd: ROOT,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      env,
    });
    try {
      closeSync(fd);
    } catch {}
    child.unref();
    appChild = child;
    appPid = child.pid;
    state.appPid = child.pid;
    saveState();
    log(`Started app (PID ${child.pid}).`);
    if (!(await waitForApp(90_000))) {
      if (!appChild || appChild.exitCode !== null) {
        state.appPid = null;
        appPid = null;
        saveState();
      }
      fail(500, `Crossfire did not start.\n\n${tailLog(APP_LOG, 25)}`);
    }
    providerCache = { at: 0, value: null };
    lastError = null;
    if (open) openUrl(APP_ORIGIN);
    return { started: true, pid: child.pid };
  } finally {
    starting = false;
  }
}

function killPid(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

async function stopApp() {
  if (stopping) fail(409, "Crossfire is already stopping.");
  stopping = true;
  try {
    const status = await getAppStatus(true);
    if (!status.running && !(await isPortOpen(APP_PORT))) {
      state.appPid = null;
      appPid = null;
      appChild = null;
      saveState();
      return { stopped: false };
    }
    const pid = findAppPid();
    if (!pid) {
      fail(409, "Crossfire is running, but its process could not be identified. Stop it from its terminal.");
    }
    log(`Stopping app (PID ${pid}).`);
    try {
      killPid(pid);
    } catch {
      fail(500, `Could not stop the process (PID ${pid}).`);
    }
    if (!(await waitForPortClosed(APP_PORT, 15_000))) {
      fail(500, `Crossfire did not stop (PID ${pid}).`);
    }
    if (state.appPid === pid) state.appPid = null;
    appPid = null;
    appChild = null;
    saveState();
    lastError = null;
    log("App stopped.");
    return { stopped: true, pid };
  } finally {
    stopping = false;
  }
}

async function testKey(key) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        ok: false,
        error: response.status === 401 ? "OpenRouter rejected that key." : `OpenRouter returned ${response.status}.`,
      };
    }
    const body = await response.json();
    const data = body?.data ?? {};
    return {
      ok: true,
      configured: true,
      label: data.label,
      isFreeTier: data.is_free_tier,
      usage: data.usage,
      freeRequests: data.free_model_daily_requests,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === "TimeoutError" ? "OpenRouter did not respond in time." : "Could not reach OpenRouter.",
    };
  }
}

async function buildStatus() {
  if (state.appPid && !isPidAlive(state.appPid)) {
    state.appPid = null;
    saveState();
  }
  const [status, keyInfo] = await Promise.all([getAppStatus(), Promise.resolve(readKeyInfo())]);
  const lock = readLock();
  return {
    app: {
      running: status.running,
      url: APP_ORIGIN,
      provider: status.provider ?? null,
      error: status.error ?? null,
      pid: status.running ? state.appPid ?? lock?.pid ?? null : null,
    },
    key: {
      configured: Boolean(keyInfo.key),
      hint: keyInfo.key ? keyHint(keyInfo.key) : null,
      source: keyInfo.source,
    },
    prefs: state.prefs,
    node: {
      version: process.versions.node,
      ok: Number(process.versions.node.split(".")[0]) >= 24,
    },
    panel: { port: PORT, url: `http://127.0.0.1:${PORT}/`, pid: process.pid },
    starting,
    stopping,
    lastError,
  };
}

function setPrefs(input) {
  state.prefs = {
    autoStart: typeof input.autoStart === "boolean" ? input.autoStart : state.prefs.autoStart,
    autoOpen: typeof input.autoOpen === "boolean" ? input.autoOpen : state.prefs.autoOpen,
  };
  saveState();
  return state.prefs;
}

function getHealth() {
  return new Promise((done) => {
    const request = httpRequest(
      { host: HOST, port: PORT, path: "/api/health", method: "GET", agent: false, timeout: 1200 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096) request.destroy();
        });
        response.on("end", () => {
          try {
            done(JSON.parse(body));
          } catch {
            done(null);
          }
        });
      },
    );
    request.on("error", () => done(null));
    request.on("timeout", () => {
      request.destroy();
      done(null);
    });
    request.end();
  });
}

function sendJson(response, status, data) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendText(response, status, body, type) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'",
  );
}

function readJson(request) {
  return new Promise((done, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024) {
        reject(new HttpError(413, "Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) return done({});
      try {
        done(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Invalid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function sameSecret(value) {
  const given = Buffer.from(String(value ?? ""));
  const expected = Buffer.from(SESSION_TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function originAllowed(request) {
  const origin = request.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

const STATIC = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/styles.css": ["styles.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
};

async function handle(request, response) {
  setSecurityHeaders(response);
  if (!ALLOWED_HOSTS.has(request.headers.host ?? "")) {
    return sendJson(response, 403, { error: "Forbidden host." });
  }
  if (request.method === "OPTIONS") {
    return sendJson(response, 405, { error: "Method not allowed." });
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? HOST}`);
  const path = url.pathname;

  if (path === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { app: "crossfire-control", version: 1 });
  }
  if (path === "/api/session" && request.method === "GET") {
    return sendJson(response, 200, { token: SESSION_TOKEN });
  }

  if (path.startsWith("/api/")) {
    if (!originAllowed(request)) return sendJson(response, 403, { error: "Forbidden origin." });
    if (!sameSecret(request.headers["x-control-token"])) {
      return sendJson(response, 401, { error: "Unauthorized." });
    }

    if (path === "/api/status" && request.method === "GET") {
      return sendJson(response, 200, await buildStatus());
    }
    if (path === "/api/start" && request.method === "POST") {
      const body = await readJson(request);
      const result = await startApp({ open: body.open === true });
      return sendJson(response, 200, { ok: true, ...result, status: await buildStatus() });
    }
    if (path === "/api/stop" && request.method === "POST") {
      const result = await stopApp();
      providerCache = { at: 0, value: null };
      return sendJson(response, 200, { ok: true, ...result, status: await buildStatus() });
    }
    if (path === "/api/restart" && request.method === "POST") {
      const body = await readJson(request);
      if (starting || stopping) fail(409, "The app is already changing state.");
      if (await isPortOpen(APP_PORT)) await stopApp();
      const result = await startApp({ open: body.open === true });
      providerCache = { at: 0, value: null };
      return sendJson(response, 200, { ok: true, ...result, status: await buildStatus() });
    }
    if (path === "/api/key" && request.method === "POST") {
      const body = await readJson(request);
      const key = normalizeKey(body.key);
      if (!isValidKey(key)) {
        return sendJson(response, 400, { error: "That does not look like an OpenRouter key." });
      }
      writeKey(key);
      log("Saved a new OpenRouter key.");
      let restarted = false;
      if (body.restart === true && !starting && !stopping) {
        const status = await getAppStatus(true);
        if (status.running) {
          try {
            await stopApp();
            await startApp({ open: false });
            restarted = true;
            log("Restarted to apply the new key.");
          } catch (error) {
            lastError = "The key was saved, but the app did not restart.";
            log(`Restart after key save failed: ${error.message}`);
            return sendJson(response, 500, {
              error: lastError,
              saved: true,
              status: await buildStatus(),
            });
          }
        }
      }
      lastError = null;
      return sendJson(response, 200, {
        ok: true,
        hint: keyHint(key),
        restarted,
        status: await buildStatus(),
      });
    }
    if (path === "/api/test-key" && request.method === "POST") {
      const body = await readJson(request);
      const supplied = normalizeKey(body.key);
      const key = supplied || readKeyInfo().key;
      if (!key) return sendJson(response, 200, { ok: false, error: "No key saved yet." });
      if (supplied && !isValidKey(supplied)) {
        return sendJson(response, 200, { ok: false, error: "That does not look like an OpenRouter key." });
      }
      const result = await testKey(key);
      log(`Key test ${result.ok ? "succeeded" : "failed"}.`);
      return sendJson(response, 200, result);
    }
    if (path === "/api/logs" && request.method === "GET") {
      const lines = Math.min(200, Math.max(20, Number(url.searchParams.get("lines")) || 80));
      return sendJson(response, 200, { text: tailLog(APP_LOG, lines) });
    }
    if (path === "/api/prefs" && request.method === "POST") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok: true, prefs: setPrefs(body) });
    }
    if (path === "/api/open" && request.method === "POST") {
      const body = await readJson(request);
      const target = String(body.target ?? "");
      const pages = { app: "/", new: "/new", beliefs: "/beliefs", settings: "/settings" };
      if (target in pages) {
        if (!(await isPortOpen(APP_PORT))) fail(409, "Start Crossfire first.");
        openUrl(`${APP_ORIGIN}${pages[target]}`);
      } else if (target === "data") {
        openPath(join(ROOT, "data"));
      } else if (target === "project") {
        openPath(ROOT);
      } else {
        fail(400, "Unknown target.");
      }
      return sendJson(response, 200, { ok: true });
    }
    if (path === "/api/quit" && request.method === "POST") {
      sendJson(response, 200, { ok: true });
      setTimeout(() => {
        log("Control panel stopped.");
        server.closeAllConnections?.();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1200);
      }, 150);
      return;
    }
    return sendJson(response, 404, { error: "Not found." });
  }

  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed." });
  if (path === "/favicon.svg") {
    try {
      return sendText(response, 200, readFileSync(join(ROOT, "src", "app", "icon.svg"), "utf8"), "image/svg+xml");
    } catch {
      return sendJson(response, 404, { error: "Not found." });
    }
  }
  if (path === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }
  const file = STATIC[path];
  if (!file) return sendJson(response, 404, { error: "Not found." });
  try {
    return sendText(response, 200, readFileSync(join(PANEL_DIR, file[0]), "utf8"), file[1]);
  } catch {
    return sendJson(response, 404, { error: "Not found." });
  }
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof HttpError ? error.message : "The control panel hit an unexpected error.";
    if (!(error instanceof HttpError)) log(`Request error: ${error.stack || error.message}`);
    sendJson(response, status, { error: message });
  });
});

server.on("error", async (error) => {
  if (error.code === "EADDRINUSE") {
    const body = await getHealth();
    if (body?.app === "crossfire-control") {
      log("Control panel is already running; opening it.");
      openUrl(`http://${HOST}:${PORT}/`);
      process.exitCode = 0;
      setTimeout(() => process.exit(0), 300);
      return;
    }
    log(`Port ${PORT} is already in use by another program.`);
    process.exitCode = 1;
    return;
  }
  log(`Panel error: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log(`Control panel listening on http://${HOST}:${PORT}`);
  if (OPEN_ON_START) openUrl(`http://${HOST}:${PORT}/`);
  setTimeout(async () => {
    const status = await getAppStatus(true);
    if (status.running) {
      if (state.prefs.autoOpen) openUrl(APP_ORIGIN);
      return;
    }
    if (!state.prefs.autoStart) return;
    if (!readKeyInfo().key) {
      log("No key saved; waiting for setup.");
      return;
    }
    startApp({ open: state.prefs.autoOpen }).catch((error) => {
      lastError = error.message;
      log(`Auto-start failed: ${error.message}`);
    });
  }, 400);
});

process.on("SIGINT", () => {
  log("Control panel interrupted.");
  server.closeAllConnections?.();
  process.exit(0);
});
process.on("SIGTERM", () => {
  log("Control panel terminated.");
  server.closeAllConnections?.();
  process.exit(0);
});
process.on("uncaughtException", (error) => log(`Uncaught: ${error.stack || error.message}`));
process.on("unhandledRejection", (error) => log(`Unhandled: ${error?.stack || error}`));
