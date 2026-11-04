import { connectState } from "/shared/ws.js";
import { normalizeLayout } from "/shared/layout.js";
import { api } from "./api.js";

let data = null;
const listeners = new Set();

export function getData() {
  return data;
}

export function setData(next) {
  data = next;
  if (data?.layout) data.layout = normalizeLayout(data.layout);
  return data;
}

export async function reloadData() {
  return setData(await api("/api/data"));
}

export function subscribeData(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(info) {
  for (const fn of listeners) fn(data, info);
}

export function startStateSocket() {
  connectState((state, info) => {
    if (!data) return;
    // Format changed elsewhere: the local games array is stale, refetch everything.
    if (
      (state.match.format && state.match.format !== data.match.format) ||
      (state.match.gameCount && state.match.gameCount !== data.match.games.length)
    ) {
      reloadData()
        .then(() => notify({ type: "state", sections: [], selectionChanged: true }))
        .catch(() => {});
      return;
    }
    data.match.score = state.match.score;
    const prevGame = data.match.currentGame;
    data.match.currentGame = state.match.currentGame;
    const g = data.match.games[state.match.currentGame];
    if (g && state.game?.score) g.score = { p1: state.game.score.p1, p2: state.game.score.p2 };
    // Keep the live game's battlefield / champion picks in sync (Stream Deck, hotkeys…).
    let selectionChanged = prevGame !== data.match.currentGame;
    if (g && state.game?.selection) {
      const before = JSON.stringify([g.battlefield, g.champion]);
      g.battlefield = { ...state.game.selection.battlefield };
      g.champion = { ...state.game.selection.champion };
      if (before !== JSON.stringify([g.battlefield, g.champion])) selectionChanged = true;
    }
    // Broadcast: first player + counters for the live game, round/clock/show, records.
    if (g && state.game) {
      if (state.game.stats) g.stats = { p1: { ...state.game.stats.p1 }, p2: { ...state.game.stats.p2 } };
      if ("first" in state.game) g.first = state.game.first;
    }
    for (const sp of state.players || []) {
      const p = data.players?.find((x) => x.id === sp.id);
      if (p && typeof sp.record === "string") p.record = sp.record;
    }
    data.display = data.display || {};
    if (state.display?.broadcast) {
      const t = { ...state.display.broadcast.timer };
      data.display.broadcast = { ...state.display.broadcast, timer: t };
    }
    data.display.mode = state.display.mode;
    if (state.display.cardAnimation) data.display.cardAnimation = state.display.cardAnimation;
    if (state.layout) data.layout = normalizeLayout(state.layout);
    if (state.display?.cards) {
      data.display.cards = {
        p1: state.display.cards.p1?.id ?? null,
        p2: state.display.cards.p2?.id ?? null,
      };
    }
    notify({ ...(info || {}), selectionChanged });
  });
}

