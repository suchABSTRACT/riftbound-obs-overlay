import { getActiveGameId } from "../db.js";
import { searchByName } from "../cardProvider.js";
import { parseDecklist, resolveDecklist, resolveTTS } from "../decklist.js";
import { getGameAdapter } from "../gameAdapters/index.js";
import { cacheMany } from "./cardCacheService.js";
import { warmBattlefieldText } from "../cardText.js";
import { activeGameData, persistAndBroadcast } from "./stateService.js";
import { prefillChampion } from "./matchService.js";
import { requirePlayer } from "./playerService.js";

export async function previewDecklist({ format, text }) {
  if (format === "tts") {
    return resolveTTS(text);
  }
  return resolveDecklist(parseDecklist(text));
}

export async function savePlayerDeck(playerId, incoming = {}) {
  const player = requirePlayer(playerId);
  const adapter = getGameAdapter(getActiveGameId());
  const deck = adapter.normalizeDeck(incoming);
  await cacheMany(adapter.deckCardIds(deck));
  player.deck = deck;
  dropStalePicks(playerId, deck);
  await persistAndBroadcast();
  warmBattlefieldText(persistAndBroadcast); // battlefield rules text, in the background
  return deck;
}

/**
 * A new deck makes the previous deck's match picks meaningless: clear any
 * battlefield / champion / shown card of this player that isn't in the new
 * deck (otherwise the Match tab shows "none" while the overlay still shows
 * the old cards), then pre-fill the live game's champion from the new deck.
 */
function dropStalePicks(playerId, deck) {
  const gameData = activeGameData();
  const inDeck = new Set([
    deck.legend,
    ...(deck.champions || []),
    ...["battlefields", "maindeck", "sideboard", "runes"].flatMap((k) => (deck[k] || []).map((e) => e.id)),
  ]);
  const battlefields = new Set((deck.battlefields || []).map((e) => e.id));
  const champions = new Set(deck.champions || []);
  for (const g of gameData.match?.games || []) {
    if (g.battlefield?.[playerId] && !battlefields.has(g.battlefield[playerId])) g.battlefield[playerId] = null;
    if (g.champion?.[playerId] && !champions.has(g.champion[playerId])) {
      g.champion[playerId] = null;
    }
  }
  const shown = gameData.display?.cards?.[playerId];
  if (shown && !inDeck.has(shown)) gameData.display.cards[playerId] = null;
  prefillChampion(gameData);
}

export function searchCards(query) {
  return searchByName(query);
}

