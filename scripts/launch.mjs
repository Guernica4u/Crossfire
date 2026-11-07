#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const port = process.env.CROSSFIRE_PORT || "3000";
const url = `http://localhost:${port}`;
const noOpen = process.env.CROSSFIRE_NO_OPEN === "1";

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) {
  fail(`Crossfire needs Node.js 24 or newer. You have ${process.versions.node}.`);
}

if (!existsSync(join(root, "node_modules", "next", "package.json"))) {
  console.log("Installing dependencies (first run only)...");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = spawnSync(npm, ["install"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (install.status !== 0) fail("Dependency installation failed.");
}

function envFileHasKey(file) {
  if (!existsSync(file)) return false;
  return /^\s*OPENROUTER_API_KEY\s*=\s*\S+/m.test(readFileSync(file, "utf8"));
}

const keyConfigured =
  Boolean(process.env.OPENROUTER_API_KEY) ||
  envFileHasKey(join(root, ".env.local")) ||
  envFileHasKey(join(root, ".env"));

if (!keyConfigured) {
  fail(
    "No OpenRouter API key found.\n\n" +
      "1. Get a free key at https://openrouter.ai/settings/keys\n" +
      "2. Add this line to .env.local:\n\n" +
      "   OPENROUTER_API_KEY=sk-or-...\n",
  );
}

async function isUp() {
  try {
    const response = await fetch(`${url}/api/provider/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  if (noOpen) {
    console.log(`Open ${url} in your browser.`);
    return;
  }
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

if (await isUp()) {
  console.log(`Crossfire is already running at ${url}`);
  openBrowser();
  process.exit(0);
}

console.log("Starting Crossfire...");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const args = port === "3000" ? ["dev"] : ["dev", "-p", port];
const server = spawn(process.execPath, [nextBin, ...args], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

let ready = false;
const deadline = Date.now() + 90_000;
while (!ready && Date.now() < deadline) {
  if (server.exitCode !== null) break;
  await new Promise((done) => setTimeout(done, 500));
  ready = await isUp();
}

if (!ready) {
  console.error("\nCrossfire did not start. Check the log above.");
  server.kill();
  process.exit(1);
}

console.log(`\nCrossfire is running at ${url}\n`);
openBrowser();

const shutdown = (signal) => {
  if (server.exitCode === null) server.kill(signal);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
