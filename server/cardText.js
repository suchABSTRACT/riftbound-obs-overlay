// Rules text for cached Riftbound cards (used by the matchup screen to print a
// battlefield's name and ability under its art).
//
// RiftScribe's card detail is tried first. If it carries no text we fall back
// to Riftcodex (https://api.riftcodex.com, public, no key), matched by name.
// The result is stored on the cache entry as `text` ("" when nothing was
// found, so we don't keep asking).

import { getActiveGameData, getActiveGameId } from "./db.js";
import { fetchCardDetail } from "./riftscribe.js";
import { logStartup } from "./startupLog.js";

const RIFTCODEX = "https://api.riftcodex.com";

/** HTML / rich text → plain text with line breaks kept. */
function plain(s) {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pull rules text out of a card object whatever the API calls the field. */
export function extractCardText(detail) {
  if (!detail || typeof detail !== "object") return "";
  const t = detail.text;
  if (t && typeof t === "object") {
    if (t.rich) return plain(t.rich);
    if (t.plain) return plain(t.plain);
  }
  for (const key of ["text", "rules_text", "rulesText", "effect", "effect_text", "ability", "description", "card_text"]) {
    const v = detail[key];
    if (typeof v === "string" && v.trim()) return plain(v);
  }
  for (const key of ["rules", "abilities"]) {
    const v = detail[key];
    if (Array.isArray(v) && v.length) {
      return plain(v.map((r) => (typeof r === "string" ? r : r?.text || r?.effect || "")).filter(Boolean).join("\n"));
    }
  }
  return "";
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function fromRiftcodex(name) {
  if (!name) return "";
  const res = await fetch(`${RIFTCODEX}/cards/name?fuzzy=${encodeURIComponent(name)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return "";
  const body = await res.json();
  const items = Array.isArray(body) ? body : body?.items || [];
  const hit = items.find((c) => norm(c?.name) === norm(name)) || null;
  return hit ? extractCardText(hit) : "";
}

let logged = false;

/** Make sure a cached card has `text`. Returns true when the entry changed. */
export async function ensureCardText(cardId) {
  const entry = getActiveGameData().cardsCache?.[cardId];
  if (!entry || typeof entry.text === "string") return false;
  let text = "";
  try {
    const detail = await fetchCardDetail(cardId);
    text = extractCardText(detail);
    if (!text && !logged) {
      logged = true;
      logStartup("[cardText] no text field in RiftScribe detail; keys:", Object.keys(detail || {}).join(","));
    }
  } catch (err) {
    logStartup(`[cardText] RiftScribe ${cardId}`, err);
  }
  if (!text) {
    try {
      text = await fromRiftcodex(entry.name);
    } catch (err) {
      logStartup(`[cardText] Riftcodex ${entry.name}`, err);
      return false; // network trouble: try again next time
    }
  }
  entry.text = text;
  return true;
}

let running = null;

/**
 * Fill in text for every battlefield in the players' decks (and in the match),
 * then save + broadcast once. Safe to call often; runs one pass at a time.
 */
export function warmBattlefieldText(persistAndBroadcast) {
  if (getActiveGameId() !== "riftbound") return Promise.resolve();
  if (running) return running;
  running = (async () => {
    const data = getActiveGameData();
    const ids = new Set();
    for (const p of data.players || []) for (const e of p.deck?.battlefields || []) if (e?.id) ids.add(e.id);
    for (const g of data.match?.games || []) for (const id of Object.values(g.battlefield || {})) if (id) ids.add(id);
    let changed = false;
    for (const id of ids) {
      if (await ensureCardText(id)) changed = true;
    }
    if (changed) await persistAndBroadcast();
  })()
    .catch((err) => logStartup("[cardText] warm failed", err))
    .finally(() => {
      running = null;
    });
  return running;
}
