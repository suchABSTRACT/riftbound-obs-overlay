// Full art for the decklist Spotlight.
//
// Riftbound Legends are League of Legends champions, and Riot publishes each
// champion's splash art (every skin) on Data Dragon, its public game-data CDN.
// For each Legend we work out the champion — from the Legend's name, its
// Riftcodex tags (e.g. "Master Yi"), or the deck's Champion unit name — then
// download that champion's splash once into the card cache.
//
// Per Legend (display.broadcast.spotArt[legendId]):
//   skin — skin number (0 = default splash)
//   url  — a custom image link instead of the splash
// The cache entry gets `spotLocal` (served path), `champKey` and `spotNote`
// (a short line for the control panel saying where the art came from).

import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { getActiveGameData, getActiveGameId } from "./db.js";
import { getCardsDir } from "./paths.js";
import { logStartup } from "./startupLog.js";

const DD = "https://ddragon.leagueoflegends.com";
const RIFTCODEX = "https://api.riftcodex.com";
const TIMEOUT = 15000;

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

// ---- champion list (Data Dragon) -------------------------------------------------------

let champList = null; // [{ key: "MasterYi", name: "master yi" }], longest names first

async function champions() {
  if (champList) return champList;
  const versions = await getJson(`${DD}/api/versions.json`);
  const data = await getJson(`${DD}/cdn/${versions[0]}/data/en_US/champion.json`);
  champList = Object.values(data.data || {})
    .map((c) => ({ key: c.id, name: norm(c.name) }))
    .sort((a, b) => b.name.length - a.name.length);
  return champList;
}

/** First champion whose name appears (as whole words) in any of the texts. */
function findChampion(list, texts) {
  for (const t of texts.map(norm).filter(Boolean)) {
    const padded = ` ${t} `;
    const hit = list.find((c) => padded.includes(` ${c.name} `));
    if (hit) return hit.key;
  }
  return null;
}

async function riftcodexTags(name) {
  if (!name) return [];
  try {
    const body = await getJson(`${RIFTCODEX}/cards/name?fuzzy=${encodeURIComponent(name)}`);
    const items = Array.isArray(body) ? body : body?.items || [];
    const hit = items.find((c) => norm(c?.name) === norm(name)) || items[0];
    return Array.isArray(hit?.tags) ? hit.tags : [];
  } catch {
    return [];
  }
}

// ---- downloads ----------------------------------------------------------------------

function cardsDir() {
  return getCardsDir(getActiveGameId());
}

const exists = (p) =>
  access(p).then(
    () => true,
    () => false
  );

async function download(url, fileName) {
  const dest = join(cardsDir(), fileName);
  if (!(await exists(dest))) {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT * 2) });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    const type = res.headers.get("content-type") || "";
    if (type && !type.startsWith("image/")) throw new Error(`not an image (${type})`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  }
  return `/cards/${getActiveGameId()}/${fileName}`;
}

async function splash(key, skin) {
  // "centered" is Riot's 16:9 re-crop that keeps the champion in the middle;
  // fall back to the full splash if a skin has no centered version.
  for (const kind of ["centered", "splash"]) {
    try {
      return await download(`${DD}/cdn/img/champion/${kind}/${key}_${skin}.jpg`, `spot-${key}_${skin}-${kind}.jpg`);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

// ---- public API -------------------------------------------------------------------------

export function spotSettings(legendId) {
  const s = getActiveGameData().display?.broadcast?.spotArt?.[legendId] || {};
  return { skin: Number.isInteger(s.skin) ? s.skin : 0, url: typeof s.url === "string" ? s.url : "" };
}

/**
 * Make sure a Legend has Spotlight art matching its settings.
 * Returns true when the cache entry changed.
 */
export async function ensureSpotlightArt(legendId, championId = null) {
  const data = getActiveGameData();
  const entry = data.cardsCache?.[legendId];
  if (!entry) return false;
  const { skin, url } = spotSettings(legendId);
  const want = url ? `url:${url}` : `splash:${skin}`;
  if (entry.spotFor === want && entry.spotLocal) return false;

  const before = JSON.stringify([entry.spotLocal, entry.spotNote, entry.champKey]);
  try {
    if (url) {
      const ext = (extname(new URL(url).pathname) || ".jpg").slice(0, 6);
      const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
      entry.spotLocal = await download(url, `spot-custom-${hash}${ext}`);
      entry.spotNote = "Custom image";
      entry.spotFor = want;
    } else {
      if (!entry.champKey) {
        const list = await champions();
        const champName = championId ? data.cardsCache?.[championId]?.name : "";
        entry.champKey =
          findChampion(list, [entry.name, champName]) || findChampion(list, await riftcodexTags(entry.name)) || null;
      }
      const path = entry.champKey ? await splash(entry.champKey, skin) : null;
      entry.spotLocal = path;
      entry.spotNote = path
        ? `League splash · ${entry.champKey}${skin ? ` · skin ${skin}` : ""}`
        : entry.champKey
          ? `No splash for ${entry.champKey} skin ${skin} — using card art`
          : "Champion not recognised — using card art";
      entry.spotFor = want;
    }
  } catch (err) {
    logStartup(`[spotlight] ${legendId}`, err);
    entry.spotNote = `Couldn't download art (${err.message}) — using card art`;
    // spotFor stays unset so the next warm-up tries again.
  }
  return JSON.stringify([entry.spotLocal, entry.spotNote, entry.champKey]) !== before;
}

let running = null;

/** Spotlight art for both players' Legends; saves + broadcasts once if anything changed. */
export function warmSpotlightArt(persistAndBroadcast) {
  if (getActiveGameId() !== "riftbound") return Promise.resolve();
  if (running) return running;
  running = (async () => {
    let changed = false;
    for (const p of getActiveGameData().players || []) {
      const legend = p.deck?.legend;
      if (legend && (await ensureSpotlightArt(legend, p.deck?.champions?.[0]))) changed = true;
    }
    if (changed) await persistAndBroadcast();
  })()
    .catch((err) => logStartup("[spotlight] warm failed", err))
    .finally(() => {
      running = null;
    });
  return running;
}

/** Change a Legend's art settings (skin number and/or custom image link). */
export async function setSpotlightArt({ legendId, skin, url } = {}, persistAndBroadcast) {
  if (!legendId || typeof legendId !== "string") throw Object.assign(new Error("legendId required"), { status: 400 });
  const data = getActiveGameData();
  const bc = data.display.broadcast;
  bc.spotArt ||= {};
  const cur = { ...spotSettings(legendId) };
  if (skin !== undefined) cur.skin = Math.max(0, Math.min(99, Math.round(Number(skin) || 0)));
  if (url !== undefined) {
    const u = String(url || "").trim();
    if (u && !/^https?:\/\//i.test(u)) throw Object.assign(new Error("Image link must start with http(s)://"), { status: 400 });
    cur.url = u;
  }
  bc.spotArt[legendId] = cur;
  const player = (data.players || []).find((p) => p.deck?.legend === legendId);
  await ensureSpotlightArt(legendId, player?.deck?.champions?.[0]);
  await persistAndBroadcast();
  const e = data.cardsCache?.[legendId] || {};
  return { settings: cur, spotLocal: e.spotLocal || null, note: e.spotNote || "" };
}
