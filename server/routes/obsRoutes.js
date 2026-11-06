import { Router } from "express";
import { OBS_SCREENS, connect, obsStatus, switchToScreen, updateObsSettings } from "../obs.js";

export const obsRoutes = Router();

const wrap = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req)) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// Connection state, OBS scene list and saved settings (password never returned).
obsRoutes.get("/obs", wrap(async () => obsStatus()));

// { enabled?, host?, port?, password?, target?, scenes?: { persistent?, matchup?, decklist? } }
obsRoutes.post("/obs/settings", wrap(async (req) => updateObsSettings(req.body ?? {})));

// Reconnect now (e.g. after opening OBS).
obsRoutes.post(
  "/obs/connect",
  wrap(async () => {
    connect();
    return obsStatus();
  })
);

// Switch OBS to a screen's scene right now: { screen: "persistent" | "matchup" | "decklist" }.
obsRoutes.post(
  "/obs/switch",
  wrap(async (req) => {
    const screen = req.body?.screen;
    if (!OBS_SCREENS.includes(screen)) throw Object.assign(new Error("unknown screen"), { status: 400 });
    return { result: await switchToScreen(screen), ...obsStatus() };
  })
);
