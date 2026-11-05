import { mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { DEFAULT_GAME_ID, isValidGameId, listGames } from "./games.js";
import { DATA_DIR, DB_FILE, getCardsDir, ensureCardsRoot } from "./paths.js";
import { getGameAdapter } from "./gameAdapters/index.js";

function makePlayer(id, gameId = DEFAULT_GAME_ID) {
  return getGameAdapter(gameId).makePlayer(id);
}

/** Live board counters shown on the broadcast player panels (per game). */
const STAT_KEYS = ["hand", "level"];

function defaultStats() {
  // runes: { [domain]: { total, ready } } — runes on the board this game.
  return { hand: 0, level: 0, runes: {} };
}

function makeGame() {
  return {
    battlefield: { p1: null, p2: null },
    champion: { p1: null, p2: null },
    score: { p1: 0, p2: 0 },
    // Broadcast overlay: who goes first this game + board counters.
    first: null,
    stats: { p1: defaultStats(), p2: defaultStats() },
    pokemon: {
      p1: { active: null, bench: [] },
      p2: { active: null, bench: [] },
    },
  };
}

const FORMATS = {
  bo1: { games: 1, win: 1 },
  bo3: { games: 3, win: 2 },
  bo5: { games: 5, win: 3 },
};

/** Card reveal animations for on-demand display (overlay CSS). */
const CARD_ANIMATIONS = ["none", "fade", "slide", "pop", "flip", "glow", "impact"];
const POKEMON_MAX_PRIZES = 6;

const BROADCAST_SHOW_KEYS = ["first", "level", "hand", "runes", "record", "timer", "results"];

/** Broadcast overlay settings that survive a match reset (round name, clock, what to show). */
function defaultBroadcast() {
  return {
    roundLabel: "",
    // Clock: `remaining` seconds when paused; while running, counts down from
    // `remaining` since `startedAt` (ms epoch).
    timer: { duration: 50 * 60, remaining: 50 * 60, startedAt: null },
    show: Object.fromEntries(BROADCAST_SHOW_KEYS.map((k) => [k, true])),
    // Per-card art framing for the player panels: cardId -> { x, y, zoom }.
    framing: {},
  };
}

function defaultDisplay() {
  return {
    mode: "persistent",
    cards: { p1: null, p2: null },
    cardAnimation: "pop",
    cardReveal: { p1: 0, p2: 0 },
    broadcast: defaultBroadcast(),
  };
}

function defaultMatch(format = "bo3") {
  const n = (FORMATS[format] || FORMATS.bo3).games;
  return {
    format: FORMATS[format] ? format : "bo3",
    score: { p1: 0, p2: 0 },
    currentGame: 0,
    games: Array.from({ length: n }, makeGame),
  };
}

const POKEMON_LAYOUT_VERSION = 2;

const CARD_PORTRAIT = 744 / 1039;
const CARD_LANDSCAPE = 1039 / 744;
const CANVAS_RATIO = 16 / 9;

function slotHeight(widthPct, ratio) {
  return Math.round(((widthPct * CANVAS_RATIO) / ratio) * 10) / 10;
}

function splitLegendGroups(layout) {
  const pseudoBand = 5;
  for (const side of ["p1", "p2"]) {
    const gKey = `${side}.legendGroup`;
    const group = layout[gKey];
    if (!group) continue;

    const lh = slotHeight(group.width, CARD_PORTRAIT);
    layout[`${side}.pseudo`] = {
      x: group.x,
      y: group.y,
      width: Math.max(group.width, 16),
      height: pseudoBand,
      visible: group.visible !== false,
      fontSize: group.fontSize ?? 3.2,
      align: "center",
      color: group.color ?? "#ffffff",
    };
    layout[`${side}.legend`] = {
      x: group.x,
      y: Math.round((group.y + pseudoBand) * 10) / 10,
      width: group.width,
      height: lh,
      visible: group.visible !== false,
    };
    delete layout[gKey];
  }
}

function defaultLayout() {
  return {
    "p1.pseudo": { x: 2, y: 10.2, width: 11, height: 5, visible: true, fontSize: 3.2, align: "center", color: "#ffffff" },
    "p2.pseudo": { x: 86.83477740719258, y: 10.257199020366073, width: 11, height: 5, visible: true, fontSize: 3.2, align: "center", color: "#ffffff" },
    score: { x: 42, y: 3, width: 16, height: 7, visible: false, fontSize: 5, align: "center", color: "#ffffff" },
    playArea: { x: 18.265099182241737, y: 8.169919287666701, width: 63.55587296983759, height: 91.8300807123333, visible: true },
    "match.tally": {
      x: 18.265566995359634,
      y: 88.70675431812323,
      width: 63.47521026682134,
      height: 11.293245681876773,
      visible: true,
      fontSize: 2.2,
      align: "center",
      color: "#8fa8cc",
    },
    "p1.legend": { x: 2, y: 16, width: 11, height: 27.3, visible: true },
    "p2.legend": { x: 86.56020648077944, y: 15.781077880123147, width: 11, height: 27.3, visible: true },
    "p1.battlefield": { x: 2, y: 44.3, width: 14, height: 17.8, visible: true },
    "p2.battlefield": { x: 84, y: 44.3, width: 14, height: 17.8, visible: true },
    "p1.card": { x: 2, y: 63.1, width: 11, height: 27.3, visible: true },
    "p2.card": { x: 87.01404799883991, y: 63.1, width: 11, height: 27.3, visible: true },
    "p1.champion": { x: 2, y: 86.2, width: 16, height: 5, visible: false, fontSize: 2.4, align: "center", color: "#dce6f5" },
    "p2.champion": { x: 82, y: 62.2, width: 16, height: 5, visible: false, fontSize: 2.4, align: "center", color: "#dce6f5" },
    // Broadcast blocks (hidden in the classic layout; see broadcastLayout()).
    ...BROADCAST_BLOCKS_HIDDEN(),
  };
}

// Positions match the "Filigree" mockup (canvas round 5) at 1920×1080.
const BROADCAST_BLOCKS = {
  "p1.panel": { x: 0.73, y: 1.11, width: 24.48, height: 11.11 },
  "p2.panel": { x: 74.79, y: 1.11, width: 24.48, height: 11.11 },
  scoreboard: { x: 28.65, y: 0.74, width: 42.71, height: 14.81 },
  "p1.runes": { x: 1.25, y: 12.96, width: 17.71, height: 3.15 },
  "p2.runes": { x: 81.04, y: 12.96, width: 17.71, height: 3.15 },
};
const RETIRED_SLOTS = [];
// Bump when BROADCAST_BLOCKS change shape so saved layouts move to the new spots.
const BROADCAST_LAYOUT_VERSION = 2;

function BROADCAST_BLOCKS_HIDDEN() {
  return Object.fromEntries(Object.entries(BROADCAST_BLOCKS).map(([k, v]) => [k, { ...v, visible: false }]));
}

/**
 * Broadcast preset: full-screen table cam (no background scene), player panels
 * in the top corners, scoreboard + clock top centre, rune tracks, and the
 * on-demand cards as large spotlights in the bottom corners.
 */
function broadcastLayout() {
  const layout = defaultLayout();
  for (const cfg of Object.values(layout)) cfg.visible = false;
  for (const [k, v] of Object.entries(BROADCAST_BLOCKS)) layout[k] = { ...v, visible: true };
  const cardW = 16;
  const cardH = slotHeight(cardW, CARD_PORTRAIT);
  layout["p1.card"] = { x: 0.8, y: 98.5 - cardH, width: cardW, height: cardH, visible: true };
  layout["p2.card"] = { x: 99.2 - cardW, y: 98.5 - cardH, width: cardW, height: cardH, visible: true };
  return layout;
}

const LAYOUT_PRESETS = { classic: () => defaultLayout(), broadcast: () => broadcastLayout() };

export function layoutPreset(name) {
  return LAYOUT_PRESETS[name]?.() || null;
}

function defaultPokemonLayout() {
  const cardW = 10;
  const cardH = slotHeight(cardW, CARD_PORTRAIT);
  return {
    "p1.pseudo": { x: 2, y: 2, width: 14, height: 5, visible: true, fontSize: 3.4, align: "center", color: "#ffffff" },
    "p2.pseudo": { x: 84, y: 2, width: 14, height: 5, visible: true, fontSize: 3.4, align: "center", color: "#ffffff" },
    score: { x: 42, y: 3, width: 16, height: 7, visible: false, fontSize: 5, align: "center", color: "#ffffff" },
    playArea: { x: 16, y: 10, width: 68, height: 88, visible: true },
    "match.tally": {
      x: 16,
      y: 88,
      width: 68,
      height: 10,
      visible: true,
      fontSize: 2.2,
      align: "center",
      color: "#e8e8e8",
    },
    "p1.card": { x: 2, y: 8, width: cardW, height: cardH, visible: true },
    "p2.card": { x: 88, y: 8, width: cardW, height: cardH, visible: true },
    "p1.legend": { x: 2, y: 16, width: 11, height: 27.3, visible: false },
    "p2.legend": { x: 86, y: 16, width: 11, height: 27.3, visible: false },
    "p1.battlefield": { x: 2, y: 44.3, width: 14, height: 17.8, visible: false },
    "p2.battlefield": { x: 84, y: 44.3, width: 14, height: 17.8, visible: false },
    "p1.champion": { x: 2, y: 86.2, width: 16, height: 5, visible: false, fontSize: 2.4, align: "center", color: "#cccccc" },
    "p2.champion": { x: 82, y: 86.2, width: 16, height: 5, visible: false, fontSize: 2.4, align: "center", color: "#cccccc" },
  };
}

export function defaultLayoutForGame(gameId = DEFAULT_GAME_ID) {
  return gameId === "pokemon" ? defaultPokemonLayout() : defaultLayout();
}

export function defaultGameData(gameId = DEFAULT_GAME_ID) {
  return {
    cardsCache: {},
    players: [makePlayer("p1", gameId), makePlayer("p2", gameId)],
    match: defaultMatch(),
    display: defaultDisplay(),
    layout: defaultLayoutForGame(gameId),
  };
}

function defaultData() {
  const games = {};
  for (const game of listGames()) {
    games[game.id] = defaultGameData(game.id);
  }
  return {
    session: { activeGame: DEFAULT_GAME_ID },
    games,
  };
}

function migrateLegacyTopLevel(data) {
  if (!data.players) return data;

  const legacy = {
    cardsCache: data.cardsCache || {},
    players: data.players,
    match: data.match,
    display: data.display,
    layout: data.layout,
  };

  const games = {};
  for (const game of listGames()) {
    games[game.id] = game.id === DEFAULT_GAME_ID ? legacy : defaultGameData(game.id);
  }

  return {
    session: { activeGame: DEFAULT_GAME_ID },
    games,
  };
}

function migrateFlatCardFiles() {
  const root = join(DATA_DIR, "cards");
  mkdirSync(root, { recursive: true });
  const dest = getCardsDir(DEFAULT_GAME_ID);
  mkdirSync(dest, { recursive: true });

  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }

  for (const name of entries) {
    const src = join(root, name);
    if (name === DEFAULT_GAME_ID || name === "pokemon") continue;
    try {
      if (!statSync(src).isFile()) continue;
      renameSync(src, join(dest, name));
    } catch {
      /* ignore */
    }
  }
}

function prefixCardPath(path, gameId) {
  if (!path || typeof path !== "string") return path;
  if (path.startsWith(`/cards/${gameId}/`)) return path;
  if (path.startsWith("/cards/")) {
    const file = path.slice("/cards/".length);
    if (!file.includes("/")) return `/cards/${gameId}/${file}`;
  }
  return path;
}

function migrateGameCardPaths(gameData, gameId) {
  for (const entry of Object.values(gameData.cardsCache || {})) {
    if (entry.imageLocal) entry.imageLocal = prefixCardPath(entry.imageLocal, gameId);
    if (entry.thumbLocal) entry.thumbLocal = prefixCardPath(entry.thumbLocal, gameId);
  }
}

function backfillGameData(gameData, gameId = DEFAULT_GAME_ID) {
  if (gameId === "pokemon" && (gameData.layoutVersion ?? 0) < POKEMON_LAYOUT_VERSION) {
    gameData.layout = defaultPokemonLayout();
    gameData.layoutVersion = POKEMON_LAYOUT_VERSION;
  }

  const defaults = defaultGameData(gameId);
  for (const key of Object.keys(defaults)) {
    if (gameData[key] === undefined) gameData[key] = defaults[key];
  }

  splitLegendGroups(gameData.layout);
  for (const [slot, value] of Object.entries(defaults.layout)) {
    gameData.layout[slot] ||= value;
  }

  for (const [slot, cfg] of Object.entries(gameData.layout)) {
    const ratio =
      slot.endsWith(".legend") || slot.endsWith(".card")
        ? CARD_PORTRAIT
        : slot.endsWith(".battlefield")
          ? CARD_LANDSCAPE
          : null;
    if (ratio && cfg?.width) cfg.height = slotHeight(cfg.width, ratio);
  }
  delete gameData.layout["p1.legendGroup"];
  delete gameData.layout["p2.legendGroup"];

  const match = gameData.match;
  match.format = FORMATS[match.format] ? match.format : "bo3";
  const need = FORMATS[match.format].games;
  while (match.games.length < need) match.games.push(makeGame());
  if (match.games.length > need) match.games.length = need;
  if (match.currentGame > need - 1) match.currentGame = need - 1;

  const display = gameData.display;
  if (!display.cards || typeof display.cards !== "object") {
    display.cards = { p1: null, p2: null };
  }
  for (const pid of ["p1", "p2"]) {
    if (display.cards[pid] === undefined) display.cards[pid] = null;
  }
  if (display.currentCardId) {
    display.cards.p1 ||= display.currentCardId;
    delete display.currentCardId;
  }
  if (!CARD_ANIMATIONS.includes(display.cardAnimation)) display.cardAnimation = "pop";
  if (!display.cardReveal || typeof display.cardReveal !== "object") {
    display.cardReveal = { p1: 0, p2: 0 };
  }
  for (const pid of ["p1", "p2"]) {
    if (typeof display.cardReveal[pid] !== "number") display.cardReveal[pid] = 0;
  }

  display.broadcast ||= defaultBroadcast();
  const bc = display.broadcast;
  if (typeof bc.roundLabel !== "string") bc.roundLabel = "";
  if (!bc.timer || typeof bc.timer !== "object") bc.timer = defaultBroadcast().timer;
  bc.show ||= {};
  if (!bc.framing || typeof bc.framing !== "object") bc.framing = {};
  for (const k of BROADCAST_SHOW_KEYS) if (typeof bc.show[k] !== "boolean") bc.show[k] = true;

  for (const p of gameData.players || []) {
    if (typeof p.record !== "string") p.record = "";
  }
  for (const k of Object.keys(bc.show)) if (!BROADCAST_SHOW_KEYS.includes(k)) delete bc.show[k];
  for (const slot of RETIRED_SLOTS) delete gameData.layout?.[slot];
  // Broadcast blocks were redesigned: move them to the new default spots once,
  // keeping whether the broadcast layout is in use (rune tracks follow panels).
  if (gameId !== "pokemon" && (gameData.broadcastLayoutVersion ?? 1) < BROADCAST_LAYOUT_VERSION && gameData.layout) {
    const using = gameData.layout["p1.panel"]?.visible === true || gameData.layout.scoreboard?.visible === true;
    for (const [k, v] of Object.entries(BROADCAST_BLOCKS)) {
      gameData.layout[k] = { ...v, visible: using };
    }
    gameData.broadcastLayoutVersion = BROADCAST_LAYOUT_VERSION;
  }

  for (const g of match.games) {
    if (g.first === undefined) g.first = null;
    g.stats ||= {};
    for (const pid of ["p1", "p2"]) {
      g.stats[pid] = { ...defaultStats(), ...(g.stats[pid] || {}) };
      if (!g.stats[pid].runes || typeof g.stats[pid].runes !== "object") g.stats[pid].runes = {};
    }
    if (!g.score || typeof g.score !== "object") g.score = { p1: 0, p2: 0 };
    if (typeof g.score.p1 !== "number") g.score.p1 = 0;
    if (typeof g.score.p2 !== "number") g.score.p2 = 0;
    if (!g.pokemon || typeof g.pokemon !== "object") g.pokemon = makeGame().pokemon;
    for (const pid of ["p1", "p2"]) {
      const side = g.pokemon[pid];
      if (!side || typeof side !== "object") {
        g.pokemon[pid] = { active: null, bench: [] };
      } else {
        side.active ||= null;
        side.bench = Array.isArray(side.bench) ? side.bench.filter(Boolean).slice(0, 5) : [];
      }
      if (gameId === "pokemon") {
        g.score[pid] = Math.max(0, Math.min(POKEMON_MAX_PRIZES, g.score[pid]));
      }
    }
  }

  if (gameId === "pokemon") {
    for (const player of gameData.players || []) {
      getGameAdapter(gameId).ensurePlayerDeck(player);
    }
  } else {
    for (const player of gameData.players || []) {
      getGameAdapter(gameId).ensurePlayerDeck(player);
    }
  }
}

ensureCardsRoot();
mkdirSync(DATA_DIR, { recursive: true });

const adapter = new JSONFile(DB_FILE);
export const db = new Low(adapter, defaultData());

export function getActiveGameId() {
  const id = db.data?.session?.activeGame;
  return isValidGameId(id) ? id : DEFAULT_GAME_ID;
}

export function getActiveGameData() {
  const id = getActiveGameId();
  if (!db.data.games) db.data.games = {};
  if (!db.data.games[id]) db.data.games[id] = defaultGameData(id);
  return db.data.games[id];
}

export async function setActiveGame(gameId) {
  if (!isValidGameId(gameId)) {
    throw Object.assign(new Error("invalid game"), { status: 400 });
  }
  db.data.session ||= { activeGame: DEFAULT_GAME_ID };
  db.data.session.activeGame = gameId;
  db.data.games ||= {};
  if (!db.data.games[gameId]) db.data.games[gameId] = defaultGameData(gameId);
  mkdirSync(getCardsDir(gameId), { recursive: true });
  await db.write();
  return db.data.games[gameId];
}

export async function initDb() {
  await db.read();
  db.data ||= defaultData();

  if (db.data.players) {
    db.data = migrateLegacyTopLevel(db.data);
  }

  db.data.session ||= { activeGame: DEFAULT_GAME_ID };
  if (!isValidGameId(db.data.session.activeGame)) {
    db.data.session.activeGame = DEFAULT_GAME_ID;
  }

  db.data.games ||= {};
  for (const game of listGames()) {
    if (!db.data.games[game.id]) db.data.games[game.id] = defaultGameData(game.id);
    migrateGameCardPaths(db.data.games[game.id], game.id);
    backfillGameData(db.data.games[game.id], game.id);
    mkdirSync(getCardsDir(game.id), { recursive: true });
  }

  migrateFlatCardFiles();
  await db.write();
  return db;
}

export {
  STAT_KEYS,
  BROADCAST_SHOW_KEYS,
  defaultBroadcast,
  defaultLayout,
  defaultPokemonLayout,
  defaultMatch,
  makePlayer,
  FORMATS,
  CARD_ANIMATIONS,
  defaultDisplay,
  POKEMON_MAX_PRIZES,
};
