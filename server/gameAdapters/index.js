import { DEFAULT_GAME_ID } from "../games.js";
import * as riftbound from "./riftboundAdapter.js";

const ADAPTERS = {
  riftbound,
};

export function getGameAdapter(gameId = DEFAULT_GAME_ID) {
  return ADAPTERS[gameId] || ADAPTERS[DEFAULT_GAME_ID];
}

