import { WebSocketServer } from "ws";
import { getActiveGameData, getActiveGameId, FORMATS } from "./db.js";
import { getGame } from "./games.js";
import { getCachedCard } from "./cardProvider.js";
import { getGameAdapter } from "./gameAdapters/index.js";

let wss = null;

function card(id) {
  if (!id) return null;
  return getCachedCard(id);
}

function getStateContext() {
  const gameData = getActiveGameData();
  const { players, match, display, layout, cardsCache } = gameData;
  const gameId = getActiveGameId();
  const gameInfo = getGame(gameId);
  const adapter = getGameAdapter(gameId);
  const game = match.games[match.currentGame] || { battlefield: {}, champion: {}, score: {} };
  const toWin = (FORMATS[match.format] || FORMATS.bo3).win;
  const winner =
    match.score.p1 >= toWin ? "p1" : match.score.p2 >= toWin ? "p2" : null;
  return { players, match, display, layout, cardsCache, gameId, gameInfo, adapter, game, toWin, winner };
}

export function buildStateSections() {
  const { players, match, display, layout, cardsCache, gameId, gameInfo, adapter, game, toWin, winner } =
    getStateContext();
  return {
    meta: {
      gameId,
      gameName: gameInfo?.name || gameId,
    },
    players: adapter.buildOverlayPlayers(players, cardsCache),
    match: {
      format: match.format,
      score: match.score,
      currentGame: match.currentGame,
      gameCount: match.games.length,
      toWin,
      winner,
      // Every game's battlefields and winner, for the matchup screen's game strip.
      history: match.games.map((g) => ({
        battlefield: { p1: card(g.battlefield?.p1), p2: card(g.battlefield?.p2) },
        winner: g.winner || null,
      })),
    },
    game: {
      battlefield: {
        p1: card(game.battlefield?.p1),
        p2: card(game.battlefield?.p2),
      },
      champion: {
        p1: card(game.champion?.p1),
        p2: card(game.champion?.p2),
      },
      score: {
        p1: game.score?.p1 || 0,
        p2: game.score?.p2 || 0,
      },
      // Broadcast overlay: first player + board counters for this game.
      first: game.first || null,
      stats: {
        p1: { ...(game.stats?.p1 || {}) },
        p2: { ...(game.stats?.p2 || {}) },
      },
      // Raw card ids for the control panel (independent of the image cache).
      selection: {
        battlefield: { p1: game.battlefield?.p1 ?? null, p2: game.battlefield?.p2 ?? null },
        champion: { p1: game.champion?.p1 ?? null, p2: game.champion?.p2 ?? null },
      },
    },
    display: {
      mode: display.mode,
      cards: {
        p1: card(display.cards?.p1),
        p2: card(display.cards?.p2),
      },
      cardAnimation: display.cardAnimation || "pop",
      cardReveal: {
        p1: display.cardReveal?.p1 || 0,
        p2: display.cardReveal?.p2 || 0,
      },
      broadcast: display.broadcast || null,
    },
    layout,
  };
}

/** Build the overlay-facing state, resolving card ids to cached card data. */
export function buildState() {
  return buildStateSections();
}

export function initHub(server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "state", state: buildState() }));
  });
}

export function closeHub() {
  if (wss) {
    // ws doesn't drop open clients when it shares the HTTP server, and
    // server.close() then waits for them forever (e.g. OBS's overlay source
    // stays connected), which stalled updates on "Closing app".
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        /* ignore */
      }
    }
    wss.close();
    wss = null;
  }
}

export function broadcastState() {
  if (!wss) return;
  const message = JSON.stringify({ type: "state", state: buildState() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

export function buildPatch(...sections) {
  const full = buildStateSections();
  const patch = {};
  for (const section of sections.flat()) {
    if (section in full) patch[section] = full[section];
  }
  return patch;
}

export function broadcastPatch(sections) {
  if (!wss) return;
  const list = Array.isArray(sections) ? sections : [sections];
  const patch = buildPatch(list);
  const message = JSON.stringify({ type: "patch", patch, sections: Object.keys(patch) });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}
