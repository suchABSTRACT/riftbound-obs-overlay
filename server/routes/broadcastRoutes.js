import { Router } from "express";
import {
  applyLayoutPreset,
  setFirstPlayer,
  setRecord,
  setStat,
  timerAction,
  updateBroadcast,
} from "../services/broadcastService.js";

export const broadcastRoutes = Router();

const wrap = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, result: await fn(req) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// Control panel
broadcastRoutes.post("/broadcast", wrap((req) => updateBroadcast(req.body ?? {})));
broadcastRoutes.post("/broadcast/timer", wrap((req) => timerAction(req.body?.op, req.body ?? {})));
broadcastRoutes.post("/broadcast/first", wrap((req) => setFirstPlayer(req.body?.player ?? null)));
broadcastRoutes.post("/broadcast/stat", wrap((req) => setStat(req.body ?? {})));
broadcastRoutes.post("/broadcast/record", wrap((req) => setRecord(req.body?.player, req.body?.record)));
broadcastRoutes.post("/layout/preset", wrap((req) => applyLayoutPreset(req.body?.name)));

// Hot URLs (Stream Deck / Companion "Website" or "HTTP GET" actions)
//   /api/hot/stat/p1/hand/inc   /api/hot/stat/p2/level/dec
//   /api/hot/first/p2
//   /api/hot/timer/toggle       /api/hot/timer/reset
broadcastRoutes.get(
  "/hot/stat/:player/:key/:op",
  wrap((req) => {
    const op = req.params.op;
    if (op !== "inc" && op !== "dec") throw Object.assign(new Error("op must be inc|dec"), { status: 400 });
    return setStat({ player: req.params.player, key: req.params.key, delta: op === "inc" ? 1 : -1 });
  })
);
broadcastRoutes.get("/hot/first/:player", wrap((req) => setFirstPlayer(req.params.player)));
broadcastRoutes.get("/hot/timer/:op", wrap((req) => timerAction(req.params.op)));
