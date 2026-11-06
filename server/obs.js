// OBS scene switching over obs-websocket v5 (built into OBS 28+:
// Tools → WebSocket Server Settings).
//
// When the overlay's screen changes (in-game / matchup / decklist) the app
// switches OBS to the scene picked for it, so the person running this app
// drives the cameras too. OBS can be on another computer on the network.
//
// Settings live in db.data.obs:
//   { enabled, host, port, password, target: "program" | "preview",
//     scenes: { persistent, matchup, decklist } }
// "preview" puts the scene in Studio Mode's preview for the OBS operator to
// take live (falls back to program when Studio Mode is off).
//
// Spoken with the `ws` package directly (the protocol is small), so no extra
// dependency is needed.

import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { db, getActiveGameData } from "./db.js";
import { logStartup } from "./startupLog.js";

export const OBS_SCREENS = ["persistent", "matchup", "decklist"];
const SUB_SCENES = 1 << 2;
const SUB_UI = 1 << 10;
const RETRY_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;

export function defaultObsSettings() {
  return {
    enabled: false,
    host: "127.0.0.1",
    port: 4455,
    password: "",
    target: "program",
    scenes: { persistent: "", matchup: "", decklist: "" },
  };
}

export function obsSettings() {
  const d = defaultObsSettings();
  const s = db.data.obs || {};
  return {
    ...d,
    ...s,
    port: Number(s.port) || d.port,
    target: s.target === "preview" ? "preview" : "program",
    scenes: { ...d.scenes, ...(s.scenes || {}) },
  };
}

// ---- connection --------------------------------------------------------------------

let sock = null;
let retryTimer = null;
const pending = new Map();
const status = {
  state: "off", // off | connecting | connected | error
  message: "",
  obsVersion: "",
  scenes: [],
  program: "",
  preview: "",
  studioMode: false,
  lastSwitch: null, // { screen, scene, target, at, error? }
};

export function obsStatus() {
  const s = obsSettings();
  return { ...status, settings: { ...s, password: "", hasPassword: Boolean(s.password) } };
}

function setState(state, message = "") {
  status.state = state;
  status.message = message;
}

function authString(password, salt, challenge) {
  const secret = createHash("sha256").update(password + salt).digest("base64");
  return createHash("sha256").update(secret + challenge).digest("base64");
}

function request(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    if (!sock || sock.readyState !== WebSocket.OPEN || status.state !== "connected") {
      reject(new Error("OBS not connected"));
      return;
    }
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`OBS did not answer ${requestType}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    sock.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}

async function refreshScenes() {
  const list = await request("GetSceneList");
  // OBS lists scenes bottom-up; show them in the order the OBS UI does.
  status.scenes = (list.scenes || []).map((s) => s.sceneName).reverse();
  status.program = list.currentProgramSceneName || "";
  status.preview = list.currentPreviewSceneName || "";
  try {
    status.studioMode = Boolean((await request("GetStudioModeEnabled")).studioModeEnabled);
  } catch {
    status.studioMode = false;
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!obsSettings().enabled) return;
  retryTimer = setTimeout(connect, RETRY_MS);
}

function cleanup() {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("OBS connection closed"));
  }
  pending.clear();
  if (sock) {
    sock.removeAllListeners();
    try {
      sock.terminate();
    } catch {
      /* already closed */
    }
  }
  sock = null;
}

export function connect() {
  clearTimeout(retryTimer);
  cleanup();
  const s = obsSettings();
  if (!s.enabled) {
    setState("off");
    return;
  }
  const url = `ws://${s.host}:${s.port}`;
  setState("connecting", `Connecting to ${url}…`);
  let ws;
  try {
    ws = new WebSocket(url, "obswebsocket.json", { handshakeTimeout: 4000 });
  } catch (err) {
    setState("error", err.message);
    scheduleRetry();
    return;
  }
  sock = ws;

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const { op, d = {} } = msg;
    if (op === 0) {
      // Hello → Identify (with auth when OBS has a password set)
      const identify = { rpcVersion: 1, eventSubscriptions: SUB_SCENES | SUB_UI };
      if (d.authentication) {
        if (!s.password) {
          setState("error", "OBS asks for a password — enter it below.");
          ws.close();
          return;
        }
        identify.authentication = authString(s.password, d.authentication.salt, d.authentication.challenge);
      }
      status.obsVersion = d.obsWebSocketVersion || "";
      ws.send(JSON.stringify({ op: 1, d: identify }));
    } else if (op === 2) {
      setState("connected", "");
      try {
        await refreshScenes();
      } catch (err) {
        logStartup("[obs] scene list", err);
      }
    } else if (op === 7) {
      const p = pending.get(d.requestId);
      if (!p) return;
      pending.delete(d.requestId);
      clearTimeout(p.timer);
      if (d.requestStatus?.result) p.resolve(d.responseData || {});
      else p.reject(new Error(d.requestStatus?.comment || `OBS refused ${d.requestType}`));
    } else if (op === 5) {
      const t = d.eventType;
      const e = d.eventData || {};
      if (t === "CurrentProgramSceneChanged") status.program = e.sceneName || "";
      else if (t === "CurrentPreviewSceneChanged") status.preview = e.sceneName || "";
      else if (t === "StudioModeStateChanged") status.studioMode = Boolean(e.studioModeEnabled);
      else if (t === "SceneListChanged" || t === "SceneNameChanged" || t === "SceneCreated" || t === "SceneRemoved") {
        refreshScenes().catch(() => {});
      }
    }
  });

  ws.on("close", (code, reason) => {
    const why = String(reason || "");
    if (status.state !== "error") {
      setState(
        "error",
        code === 4009
          ? "Wrong OBS WebSocket password."
          : why || (status.state === "connected" ? "OBS disconnected." : `Can't reach OBS at ${url}.`)
      );
    } else if (code === 4009) {
      setState("error", "Wrong OBS WebSocket password.");
    }
    cleanup();
    scheduleRetry();
  });
  ws.on("error", (err) => {
    setState("error", err.code === "ECONNREFUSED" ? `Can't reach OBS at ${url} — is OBS open with the WebSocket server on?` : err.message);
  });
}

export async function updateObsSettings(patch = {}) {
  const cur = obsSettings();
  const next = { ...cur };
  if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
  if (typeof patch.host === "string" && patch.host.trim()) next.host = patch.host.trim();
  if (patch.port !== undefined) {
    const n = Number(patch.port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw Object.assign(new Error("Port must be 1–65535"), { status: 400 });
    next.port = n;
  }
  if (typeof patch.password === "string") next.password = patch.password; // "" clears it
  if (patch.target === "program" || patch.target === "preview") next.target = patch.target;
  if (patch.scenes && typeof patch.scenes === "object") {
    next.scenes = { ...cur.scenes };
    for (const k of OBS_SCREENS) if (typeof patch.scenes[k] === "string") next.scenes[k] = patch.scenes[k];
  }
  db.data.obs = next;
  await db.write();
  const reconnect = ["enabled", "host", "port", "password"].some((k) => next[k] !== cur[k]);
  if (reconnect) connect();
  return obsStatus();
}

// ---- switching ----------------------------------------------------------------------

/** Switch OBS to the scene picked for a screen. */
export async function switchToScreen(screen) {
  const s = obsSettings();
  const scene = s.scenes[screen];
  if (!scene) return { skipped: true };
  const toPreview = s.target === "preview" && status.studioMode;
  const entry = { screen, scene, target: toPreview ? "preview" : "program", at: Date.now() };
  try {
    await request(toPreview ? "SetCurrentPreviewScene" : "SetCurrentProgramScene", { sceneName: scene });
  } catch (err) {
    entry.error = err.message;
  }
  status.lastSwitch = entry;
  if (entry.error) logStartup(`[obs] switch to ${scene}`, entry.error);
  return entry;
}

const screenOf = (mode) => (mode === "matchup" || mode === "decklist" ? mode : "persistent");
let lastScreen = null;

/**
 * Called whenever state is broadcast: when the overlay's screen changed,
 * switch OBS to match.
 */
export function noteOverlayScreen() {
  const mode = getActiveGameData()?.display?.mode;
  const screen = screenOf(mode);
  if (lastScreen === null) {
    lastScreen = screen;
    return;
  }
  if (screen === lastScreen) return;
  lastScreen = screen;
  if (obsSettings().enabled && status.state === "connected") switchToScreen(screen).catch(() => {});
}

export function startObs() {
  // Remember the screen we start on, so the first change is acted on.
  lastScreen = screenOf(getActiveGameData()?.display?.mode);
  if (obsSettings().enabled) connect();
}

export function stopObs() {
  clearTimeout(retryTimer);
  cleanup();
}
