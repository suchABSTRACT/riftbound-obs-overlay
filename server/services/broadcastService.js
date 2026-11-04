import { BROADCAST_SHOW_KEYS, MAX_RUNES, STAT_KEYS, defaultBroadcast, layoutPreset } from "../db.js";
import { PLAYER_IDS } from "../constants.js";
import { activeGameData, persistAndBroadcast } from "./stateService.js";

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function broadcast() {
  const display = activeGameData().display;
  display.broadcast ||= defaultBroadcast();
  return display.broadcast;
}

function liveGame() {
  const match = activeGameData().match;
  const game = match.games[match.currentGame];
  if (!game) throw bad("invalid game");
  game.stats ||= {};
  for (const pid of PLAYER_IDS) {
    game.stats[pid] ||= { hand: 0, gold: 0, level: 0, runesReady: 0, runesTotal: 0 };
  }
  return game;
}

/** Seconds left on the clock right now (negative = overtime). */
export function timerRemaining(timer, now = Date.now()) {
  if (!timer) return 0;
  if (!timer.startedAt) return timer.remaining;
  return timer.remaining - (now - timer.startedAt) / 1000;
}

// ---- settings ----------------------------------------------------------------

export async function updateBroadcast({ roundLabel, show } = {}) {
  const bc = broadcast();
  if (typeof roundLabel === "string") bc.roundLabel = roundLabel.slice(0, 60);
  if (show && typeof show === "object") {
    for (const k of BROADCAST_SHOW_KEYS) if (typeof show[k] === "boolean") bc.show[k] = show[k];
  }
  await persistAndBroadcast(["display"]);
  return bc;
}

// ---- clock -------------------------------------------------------------------

export async function timerAction(op, { seconds } = {}) {
  const t = broadcast().timer;
  const now = Date.now();
  const running = Boolean(t.startedAt);
  switch (op) {
    case "start":
      if (!running) t.startedAt = now;
      break;
    case "pause":
      if (running) {
        t.remaining = Math.round(timerRemaining(t, now));
        t.startedAt = null;
      }
      break;
    case "toggle":
      return timerAction(running ? "pause" : "start");
    case "reset":
      t.remaining = t.duration;
      t.startedAt = null;
      break;
    case "set": {
      const s = Math.round(Number(seconds));
      if (!Number.isFinite(s) || s < 0 || s > 6 * 3600) throw bad("seconds must be 0–21600");
      t.duration = s;
      t.remaining = s;
      t.startedAt = null;
      break;
    }
    case "add": {
      const s = Math.round(Number(seconds));
      if (!Number.isFinite(s)) throw bad("seconds required");
      t.remaining += s;
      break;
    }
    default:
      throw bad("op must be start|pause|toggle|reset|set|add");
  }
  await persistAndBroadcast(["display"]);
  return { ...t, now };
}

// ---- per-game board state ----------------------------------------------------------

export async function setFirstPlayer(player) {
  if (player !== null && !PLAYER_IDS.includes(player)) throw bad("player must be p1, p2 or null");
  const game = liveGame();
  game.first = game.first === player ? null : player;
  await persistAndBroadcast(["game"]);
  return game.first;
}

/** Change one counter: pass `delta` (+1/-1) or an absolute `value`. */
export async function setStat({ player, key, delta, value } = {}) {
  if (!PLAYER_IDS.includes(player)) throw bad("invalid player");
  if (!STAT_KEYS.includes(key)) throw bad(`key must be one of ${STAT_KEYS.join(", ")}`);
  const stats = liveGame().stats[player];
  let next = typeof value === "number" ? value : (stats[key] || 0) + (Number(delta) || 0);
  next = Math.max(0, Math.round(next));
  if (key === "runesTotal") {
    next = Math.min(MAX_RUNES, next);
    stats.runesReady = Math.min(stats.runesReady, next);
  }
  if (key === "runesReady") next = Math.min(stats.runesTotal, next);
  if (key !== "runesTotal" && key !== "runesReady") next = Math.min(99, next);
  stats[key] = next;
  await persistAndBroadcast(["game"]);
  return stats;
}

/** Ready every rune (start of turn). */
export async function readyRunes(player) {
  if (!PLAYER_IDS.includes(player)) throw bad("invalid player");
  const stats = liveGame().stats[player];
  stats.runesReady = stats.runesTotal;
  await persistAndBroadcast(["game"]);
  return stats;
}

export async function setRecord(player, record) {
  if (!PLAYER_IDS.includes(player)) throw bad("invalid player");
  const p = activeGameData().players.find((x) => x.id === player);
  if (!p) throw bad("unknown player");
  p.record = String(record ?? "").slice(0, 24);
  await persistAndBroadcast(["players"]);
  return p.record;
}

// ---- layout presets ------------------------------------------------------------

export async function applyLayoutPreset(name) {
  const layout = layoutPreset(name);
  if (!layout) throw bad("preset must be classic or broadcast");
  activeGameData().layout = layout;
  await persistAndBroadcast(["layout"]);
  return layout;
}
