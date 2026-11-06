import test from "node:test";
import assert from "node:assert/strict";
import { getGameAdapter } from "../server/gameAdapters/index.js";

test("riftbound adapter normalizes deck and display cards", () => {
  const adapter = getGameAdapter("riftbound");
  const deck = adapter.normalizeDeck({
    legend: "sfd-197-221",
    champions: [{ id: "champion-1" }],
    maindeck: [{ id: "card-1", quantity: 2 }],
    sideboard: ["side-1"],
  });

  assert.deepEqual(adapter.deckCardIds(deck), ["sfd-197-221", "champion-1", "card-1", "side-1"]);
  assert.deepEqual(
    adapter.displayCardEntries(deck, {
      "sfd-197-221": { name: "Emperor" },
      "champion-1": { name: "Champion" },
      "card-1": { name: "Main Card" },
      "side-1": { name: "Side Card" },
    }).map((e) => [e.group, e.label]),
    [
      ["Legend", "Emperor"],
      ["Champion", "Champion"],
      ["Main deck", "Main Card ×2"],
      ["Side deck", "Side Card"],
    ]
  );
});

