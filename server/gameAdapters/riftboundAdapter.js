export function makePlayer(id) {
  return {
    id,
    pseudo: "",
    record: "",
    deck: {
      legend: null,
      champions: [],
      battlefields: [],
      maindeck: [],
      runes: [],
      sideboard: [],
    },
  };
}

export function normalizeDeck(input = {}) {
  const norm = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((e) => (typeof e === "string" ? { id: e, quantity: 1 } : e))
      .filter((e) => e && e.id)
      .map((e) => ({ id: e.id, quantity: Number(e.quantity) || 1 }));
  const normIds = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((e) => (typeof e === "string" ? e : e?.id))
      .filter(Boolean);

  return {
    legend: input.legend || null,
    champions: normIds(input.champions),
    battlefields: norm(input.battlefields),
    maindeck: norm(input.maindeck),
    runes: norm(input.runes),
    sideboard: norm(input.sideboard),
  };
}

export function deckCardIds(deck = {}) {
  return [
    deck.legend,
    ...(deck.champions || []),
    ...(deck.battlefields || []).map((e) => e.id),
    ...(deck.maindeck || []).map((e) => e.id),
    ...(deck.runes || []).map((e) => e.id),
    ...(deck.sideboard || []).map((e) => e.id),
  ].filter(Boolean);
}

export function displayCardEntries(deck = {}, cardsCache = {}) {
  const entries = [];
  const seen = new Set();
  const add = (group, id, quantity = 1) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const name = cardsCache[id]?.name || id;
    const label = quantity > 1 ? `${name} ×${quantity}` : name;
    entries.push({ index: entries.length, id, name, group, quantity, label });
  };

  if (deck.legend) add("Legend", deck.legend);
  for (const id of deck.champions || []) add("Champion", id);
  for (const e of deck.maindeck || []) add("Main deck", e.id, Number(e.quantity) || 1);
  for (const e of deck.sideboard || []) add("Side deck", e.id, Number(e.quantity) || 1);

  return entries;
}

export function playerBattlefields(player, cardsCache = {}) {
  return (player.deck?.battlefields || []).map((entry) => {
    const id = entry.id;
    const name = cardsCache[id]?.name || id;
    return { id, name, label: name };
  });
}

const DOMAINS = ["fury", "calm", "mind", "body", "chaos", "order"];

/** Rune domains in a deck, in decklist order (e.g. ["fury", "chaos"]). */
export function runeDomains(deck = {}, cardsCache = {}) {
  const out = [];
  for (const e of deck.runes || []) {
    const c = cardsCache[e.id] || {};
    const words = `${c.name || ""} ${c.faction || ""} ${e.id || ""}`.toLowerCase();
    const d = DOMAINS.find((x) => words.includes(x));
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

export function buildOverlayPlayers(players = [], cardsCache = {}) {
  const card = (id) => (id ? cardsCache[id] || null : null);
  return players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    record: p.record || "",
    runeDomains: runeDomains(p.deck, cardsCache),
    legend: card(p.deck.legend),
    champion: card((p.deck.champions || [])[0]),
    battlefields: (p.deck.battlefields || []).map((e) => card(e.id)).filter(Boolean),
  }));
}

export function ensurePlayerDeck(player) {
  player.deck ||= {};
  player.deck.legend ??= null;
  player.deck.champions ||= [];
  player.deck.battlefields ||= [];
  player.deck.maindeck ||= [];
  player.deck.runes ||= [];
  player.deck.sideboard ||= [];
}

