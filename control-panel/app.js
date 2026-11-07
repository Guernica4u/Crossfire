const $ = (id) => document.getElementById(id);

const els = {
  panelPill: $("panel-pill"),
  panelPillText: $("panel-pill-text"),
  appPill: $("app-pill"),
  appPillText: $("app-pill-text"),
  heroTitle: $("hero-title"),
  heroSub: $("hero-sub"),
  openApp: $("open-app"),
  startApp: $("start-app"),
  stopApp: $("stop-app"),
  restartApp: $("restart-app"),
  busyLabel: $("busy-label"),
  busyText: $("busy-text"),
  appBadge: $("app-badge"),
  statusServer: $("status-server"),
  statusKey: $("status-key"),
  statusQuota: $("status-quota"),
  quotaFill: $("quota-fill"),
  statusNote: $("status-note"),
  statusPid: $("status-pid"),
  statusNode: $("status-node"),
  keyBadge: $("key-badge"),
  keySaved: $("key-saved"),
  keyHint: $("key-hint"),
  keyInput: $("key-input"),
  testKey: $("test-key"),
  saveKey: $("save-key"),
  keyResult: $("key-result"),
  prefAutoStart: $("pref-autostart"),
  prefAutoOpen: $("pref-autoopen"),
  refreshStatus: $("refresh-status"),
  quitPanel: $("quit-panel"),
  refreshLog: $("refresh-log"),
  log: $("log"),
  toast: $("toast"),
};

let tokenPromise = null;
let state = null;
let refreshing = false;
let localBusy = false;
let prefsDirty = false;
let failures = 0;
let toastTimer = null;
let pollTimer = null;
let logTimer = null;

async function getToken() {
  if (!tokenPromise) {
    tokenPromise = fetch("/api/session", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not open a control-panel session.");
        return response.json();
      })
      .then((body) => body.token);
  }
  return tokenPromise;
}

async function api(path, options = {}) {
  const token = await getToken();
  const headers = { ...(options.headers || {}), "X-Control-Token": token };
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text || `Request failed (${response.status}).` };
  }
  if (!response.ok) {
    if (response.status === 401) tokenPromise = null;
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return body;
}

function toast(message, kind = "ok") {
  els.toast.textContent = message;
  els.toast.className = `toast show ${kind === "error" ? "error" : ""}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 4800);
}

function setBadge(text, variant) {
  els.appBadge.textContent = text;
  els.appBadge.className = `badge ${variant}`;
}

function render(status) {
  state = status;
  const running = status.app.running;
  const starting = status.starting;
  const stopping = status.stopping;
  const busy = starting || stopping || localBusy;
  const configured = status.key.configured;
  const provider = status.app.provider;
  const quota = provider?.freeRequests;

  const appState = starting ? "starting" : stopping ? "starting" : running ? "live" : "offline";
  els.appPill.dataset.state = appState;
  els.appPillText.textContent = starting ? "STARTING" : stopping ? "STOPPING" : running ? "LIVE" : "OFFLINE";
  els.panelPill.dataset.state = failures ? "offline" : "live";
  els.panelPillText.textContent = failures ? "PANEL LOST" : "LOCAL PANEL";

  if (starting) {
    setBadge("STARTING", "starting");
    els.heroTitle.textContent = "Waking the arena.";
    els.heroSub.textContent = "The local server is compiling. This usually takes a few seconds.";
  } else if (stopping) {
    setBadge("STOPPING", "starting");
    els.heroTitle.textContent = "Closing the room.";
    els.heroSub.textContent = "The local server is shutting down.";
  } else if (running && configured) {
    setBadge("LIVE", "live");
    els.heroTitle.textContent = "The arena is live.";
    els.heroSub.textContent = quota
      ? `Three seats, one judge, and ${quota.remaining} of ${quota.limit} free requests left today.`
      : "Three seats, one judge, and a free model pool. Walk into any room.";
  } else if (running && !configured) {
    setBadge("LIVE", "live");
    els.heroTitle.textContent = "The arena needs a key.";
    els.heroSub.textContent = "The server is up, but OpenRouter is not connected. Save a key below.";
  } else if (!configured) {
    setBadge("OFFLINE", "offline");
    els.heroTitle.textContent = "One key from ready.";
    els.heroSub.textContent = "Paste your OpenRouter key below, then start the local server.";
  } else {
    setBadge("OFFLINE", "offline");
    els.heroTitle.textContent = "The arena is asleep.";
    els.heroSub.textContent = "Start the local server, then walk into any room.";
  }

  els.openApp.disabled = !running || busy;
  els.startApp.disabled = running || busy;
  els.stopApp.disabled = !running || busy;
  els.restartApp.disabled = !running || busy;
  els.saveKey.disabled = busy;
  els.testKey.disabled = busy;
  document.querySelectorAll(".quick[data-target]").forEach((button) => {
    button.disabled = !running || busy;
  });

  els.statusServer.textContent = running ? "localhost:3000" : "Not responding";
  els.statusKey.textContent = configured
    ? status.key.source === "environment"
      ? "Environment"
      : "Saved"
    : "Missing";
  els.statusQuota.textContent = quota ? `${quota.remaining} / ${quota.limit}` : "—";
  const remaining = quota && quota.limit ? quota.remaining / quota.limit : 0;
  els.quotaFill.style.width = `${Math.max(0, Math.min(100, remaining * 100))}%`;
  els.quotaFill.classList.toggle("low", Boolean(quota && remaining < 0.2));
  els.statusNote.textContent =
    status.lastError ||
    provider?.error ||
    (running
      ? "Free pool resets daily. The app falls back across free models only."
      : "Start the server to check the free pool.");
  els.statusPid.textContent = status.app.pid ? `PID ${status.app.pid}` : "No process";
  els.statusNode.textContent = `Node ${status.node.version}`;
  els.statusNode.classList.toggle("bad", !status.node.ok);

  els.keyBadge.textContent = configured ? "READY" : "NEEDED";
  els.keyBadge.className = `badge ${configured ? "ready" : "needed"}`;
  els.keySaved.classList.toggle("is-missing", !configured);
  els.keyHint.textContent = status.key.hint || "No key saved";

  if (!prefsDirty) {
    els.prefAutoStart.checked = status.prefs.autoStart;
    els.prefAutoOpen.checked = status.prefs.autoOpen;
  }

  document.title = running ? "Crossfire — live" : "Crossfire — control panel";
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const status = await api("/api/status");
    failures = 0;
    render(status);
  } catch (error) {
    failures += 1;
    els.appPill.dataset.state = "offline";
    els.appPillText.textContent = "PANEL LOST";
    els.panelPill.dataset.state = "offline";
    els.panelPillText.textContent = "PANEL LOST";
    els.statusNote.textContent = "The control panel is not responding. Reopen it from Crossfire.vbs.";
    if (failures >= 5) {
      clearInterval(pollTimer);
      clearInterval(logTimer);
      toast("Control panel lost. Reopen it from Crossfire.vbs.", "error");
    }
  } finally {
    refreshing = false;
  }
}

async function withBusy(label, action) {
  if (localBusy) return;
  localBusy = true;
  els.busyText.textContent = label;
  els.busyLabel.hidden = false;
  if (state) render(state);
  try {
    await action();
  } catch (error) {
    toast(error.message || String(error), "error");
  } finally {
    localBusy = false;
    els.busyLabel.hidden = true;
    await refresh();
  }
}

function startArena() {
  return withBusy("Starting Crossfire…", async () => {
    const result = await api("/api/start", {
      method: "POST",
      body: JSON.stringify({ open: true }),
    });
    toast(result.already ? "Crossfire is already running." : "Crossfire is live.");
  });
}

function stopArena() {
  if (!confirm("Stop the Crossfire server? The control panel will stay open.")) return;
  return withBusy("Stopping Crossfire…", async () => {
    await api("/api/stop", { method: "POST" });
    toast("Crossfire stopped.");
  });
}

function restartArena() {
  return withBusy("Restarting Crossfire…", async () => {
    await api("/api/restart", { method: "POST", body: JSON.stringify({ open: true }) });
    toast("Crossfire restarted.");
  });
}

function saveKey() {
  const key = els.keyInput.value.trim();
  if (!key) {
    toast("Paste a new key first.", "error");
    return;
  }
  return withBusy("Saving key…", async () => {
    const result = await api("/api/key", {
      method: "POST",
      body: JSON.stringify({ key, restart: Boolean(state?.app.running) }),
    });
    els.keyInput.value = "";
    els.keyResult.hidden = true;
    toast(result.restarted ? "Key saved. Crossfire restarted." : "Key saved.");
  });
}

function testKey() {
  const supplied = els.keyInput.value.trim();
  return withBusy("Testing key…", async () => {
    const result = await api("/api/test-key", {
      method: "POST",
      body: JSON.stringify(supplied ? { key: supplied } : {}),
    });
    els.keyResult.hidden = false;
    els.keyResult.className = `key-result ${result.ok ? "ok" : "error"}`;
    els.keyResult.textContent = result.ok
      ? `${supplied ? "This key works. Save it below to use it." : "The saved key works."}${
          result.freeRequests
            ? ` ${result.freeRequests.remaining} of ${result.freeRequests.limit} free requests left.`
            : ""
        }`
      : result.error || "The key was rejected.";
    toast(result.ok ? "Key verified." : "Key check failed.", result.ok ? "ok" : "error");
  });
}

async function openTarget(target) {
  try {
    await api("/api/open", { method: "POST", body: JSON.stringify({ target }) });
  } catch (error) {
    toast(error.message, "error");
  }
}

async function savePrefs() {
  prefsDirty = true;
  const prefs = { autoStart: els.prefAutoStart.checked, autoOpen: els.prefAutoOpen.checked };
  try {
    const result = await api("/api/prefs", { method: "POST", body: JSON.stringify(prefs) });
    if (state) state.prefs = result.prefs;
    toast("Preferences saved.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    prefsDirty = false;
    await refresh();
  }
}

async function refreshLog() {
  try {
    const result = await api("/api/logs?lines=80");
    els.log.textContent = result.text || "No server log yet.";
    els.log.scrollTop = els.log.scrollHeight;
  } catch (error) {
    els.log.textContent = `Could not read the log: ${error.message}`;
  }
}

function quitPanel() {
  if (!confirm("Quit the control panel? Crossfire will keep running.")) return;
  api("/api/quit", { method: "POST" })
    .catch(() => {})
    .finally(() => {
      clearInterval(pollTimer);
      clearInterval(logTimer);
      toast("Control panel stopped. You can close this tab.");
      document.body.style.opacity = "0.55";
    });
}

els.openApp.addEventListener("click", () => void openTarget("app"));
els.startApp.addEventListener("click", () => void startArena());
els.stopApp.addEventListener("click", () => void stopArena());
els.restartApp.addEventListener("click", () => void restartArena());
els.saveKey.addEventListener("click", () => void saveKey());
els.testKey.addEventListener("click", () => void testKey());
els.keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void saveKey();
  }
});
els.refreshStatus.addEventListener("click", () => void refresh().then(refreshLog));
els.refreshLog.addEventListener("click", () => void refreshLog());
els.prefAutoStart.addEventListener("change", () => void savePrefs());
els.prefAutoOpen.addEventListener("change", () => void savePrefs());
els.quitPanel.addEventListener("click", quitPanel);
document.querySelectorAll("[data-target]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    void openTarget(button.dataset.target);
  });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refresh();
    void refreshLog();
  }
});

void refresh();
void refreshLog();
pollTimer = setInterval(() => {
  if (!document.hidden) void refresh();
}, 3500);
logTimer = setInterval(() => {
  if (!document.hidden) void refreshLog();
}, 7000);
