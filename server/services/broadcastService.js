import { BROADCAST_SHOW_KEYS, STAT_KEYS, defaultBroadcast, layoutPreset } from "../db.js";
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
    game.stats[pid] ||= { hand: 0, level: 0, runes: {} };
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
  next = Math.min(99, Math.max(0, Math.round(next)));
  stats[key] = next;
  await persistAndBroadcast(["game"]);
  return stats;
}

const RUNE_DOMAINS = ["fury", "calm", "mind", "body", "chaos", "order"];
const MAX_RUNES = 12;

/**
 * Runes on the board for one domain: `key` "total" (channelled) or "ready",
 * by `delta` or absolute `value`. Ready never exceeds total; total caps at 12
 * across all domains.
 */
export async function setRune({ player, domain, key, delta, value } = {}) {
  if (!PLAYER_IDS.includes(player)) throw bad("invalid player");
  if (!RUNE_DOMAINS.includes(domain)) throw bad(`domain must be one of ${RUNE_DOMAINS.join(", ")}`);
  if (key !== "total" && key !== "ready") throw bad("key must be total or ready");
  const stats = liveGame().stats[player];
  stats.runes ||= {};
  const r = (stats.runes[domain] ||= { total: 0, ready: 0 });
  const cur = r[key] || 0;
  let next = Math.max(0, Math.round(typeof value === "number" ? value : cur + (Number(delta) || 0)));
  if (key === "total") {
    const others = Object.entries(stats.runes).reduce((s, [d, v]) => (d === domain ? s : s + (v.total || 0)), 0);
    next = Math.min(next, MAX_RUNES - others);
    // A newly channelled rune comes in ready; removing one removes a ready one first.
    r.ready = Math.min(next, Math.max(0, r.ready + (next - cur)));
    r.total = next;
  } else {
    r.ready = Math.min(next, r.total);
  }
  await persistAndBroadcast(["game"]);
  return stats.runes;
}

/** Start of turn: every rune on the board becomes ready again. Or exhaust all. */
export async function setAllRunes(player, mode = "ready") {
  if (!PLAYER_IDS.includes(player)) throw bad("invalid player");
  const stats = liveGame().stats[player];
  for (const r of Object.values(stats.runes || {})) r.ready = mode === "exhaust" ? 0 : r.total;
  await persistAndBroadcast(["game"]);
  return stats.runes;
}

/** Save how one card's art is framed in the player panels (or reset it). */
export async function setFraming({ cardId, x, y, zoom, rot, reset } = {}) {
  if (!cardId || typeof cardId !== "string") throw bad("cardId required");
  const bcs = broadcast();
  bcs.framing ||= {};
  if (reset) {
    delete bcs.framing[cardId];
  } else {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
    const cur = bcs.framing[cardId] || {};
    const next = { ...cur };
    if (x !== undefined && Number.isFinite(Number(x))) next.x = Math.round(clamp(x, 0, 100));
    if (y !== undefined && Number.isFinite(Number(y))) next.y = Math.round(clamp(y, 0, 100));
    if (zoom !== undefined && Number.isFinite(Number(zoom))) next.zoom = Math.round(clamp(zoom, 1, 4) * 100) / 100;
    // Battlefields: rotation of the image ("auto" = turn sideways files upright).
    if (rot !== undefined) {
      if ([0, 90, -90].includes(Number(rot)) && rot !== "auto" && rot !== "") next.rot = Number(rot);
      else delete next.rot;
    }
    bcs.framing[cardId] = next;
  }
  await persistAndBroadcast(["display"]);
  return bcs.framing[cardId] || null;
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
  if (!layout) throw bad("preset must be broadcast");
  activeGameData().layout = layout;
  await persistAndBroadcast(["layout"]);
  return layout;
}
