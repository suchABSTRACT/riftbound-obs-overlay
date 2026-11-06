// Champion units a player can pick for a game.
//
// The deck's "Champion" entry is only the champion they registered; players
// may swap to another version of the same champion between games (e.g.
// "Master Yi - Honed" → "Master Yi - Meditative"). So the pick list holds every
// card in the deck or sideboard whose name starts with that champion's name.
// Shared by the control panel and the server.

/** "Master Yi - Honed" / "Kai'Sa, Survivor" → "master yi" / "kai sa". */
export function championBase(name) {
  const head = String(name || "").split(/\s+[-–—]\s+|,\s*/)[0];
  return head
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const isUnitish = (card) => !card?.type || /unit|champion/i.test(card.type);

/**
 * Card ids for the Champion Unit picker: the deck's registered champion(s)
 * first, then every other unit in the main deck or sideboard that shares the
 * champion's (or the Legend's) name.
 */
export function championChoices(deck = {}, cardsCache = {}) {
  const registered = (deck.champions || []).filter(Boolean);
  const bases = new Set(
    [...registered.map((id) => cardsCache[id]?.name), cardsCache[deck.legend]?.name]
      .map(championBase)
      .filter((b) => b.length >= 2)
  );
  const out = [...registered];
  const pool = [...(deck.maindeck || []), ...(deck.sideboard || [])].map((e) => (typeof e === "string" ? e : e?.id));
  for (const id of pool) {
    if (!id || out.includes(id)) continue;
    const card = cardsCache[id];
    if (card && isUnitish(card) && bases.has(championBase(card.name))) out.push(id);
  }
  return out;
}
