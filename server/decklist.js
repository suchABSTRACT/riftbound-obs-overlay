import { searchByName, fetchCardDetail } from "./riftscribe.js";

// Section headers, matched after normalising the line (see headerKey): any
// case, optional trailing colon, card counts like "Main Deck (40)" or
// "Runes - 12", and the names different deck builders export.
const CATEGORY_HEADERS = [
  { category: "legend", re: /^(legend|l[ée]gende)s?$/ },
  { category: "champions", re: /^(chosen\s*)?(champion|champion\s*unit)s?$/ },
  { category: "battlefields", re: /^(battlefield|champ\s*de\s*bataille)s?$/ },
  { category: "runes", re: /^(rune|runes?\s*(pool|deck)|rune\s*pools?)s?$/ },
  { category: "maindeck", re: /^(main|main\s*deck|maindeck|deck\s*principal|deck)s?$/ },
  { category: "sideboard", re: /^(side|side\s*board|sideboard|side\s*deck|r[ée]serve)s?$/ },
];

/** "Rune Pool (12):" → "rune pool" */
function headerKey(line) {
  return line
    .toLowerCase()
    .replace(/[:\-–—]+\s*$/, "")
    .replace(/\s*[([]?\s*\d+\s*(cards?)?\s*[)\]]?\s*:?\s*$/, "")
    .replace(/[:\-–—]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const LINE_RE = /^(\d+)\s*x?\s+(.+?)\s*$/i;

/**
 * Parse a sectioned text decklist into categorized entries.
 * Returns { legend, champions, maindeck, battlefields, runes, sideboard } where
 * each value is an array of { quantity, name }.
 */
export function parseDecklist(text) {
  const result = {
    legend: [],
    champions: [],
    maindeck: [],
    battlefields: [],
    runes: [],
    sideboard: [],
  };

  let current = "maindeck";

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    const key = /^\d/.test(line) ? "" : headerKey(line);
    const header = key && CATEGORY_HEADERS.find((h) => h.re.test(key));
    if (header) {
      current = header.category;
      continue;
    }

    const m = line.match(LINE_RE);
    let quantity = 1;
    let name = line;
    if (m) {
      quantity = parseInt(m[1], 10) || 1;
      name = m[2].trim();
    }
    if (!name) continue;
    result[current].push({ quantity, name });
  }

  return result;
}

const BASE_PRINTING = /^[a-z]+-\d+-\d+$/i;

/**
 * Name used for matching: lower case, without a printing suffix such as
 * " - Starter" (RiftScribe names starter-deck printings "Wuju Bladesman -
 * Starter"; decklists just say "Wuju Bladesman").
 */
function matchName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+[-–—]\s+[^-–—,]+$/, "")
    .trim();
}

function pickDefault(candidates, name) {
  if (!candidates.length) return null;
  const lower = matchName(name);
  let pool = candidates.filter((c) => matchName(c.name) === lower);
  if (!pool.length) {
    // No exact-name match (e.g. a Legend listed as "Champion, Title"): trust
    // the API relevance ordering and stay within the top candidate's name.
    const topName = matchName(candidates[0].name);
    pool = candidates.filter((c) => matchName(c.name) === topName);
  }
  // Prefer the base printing (no letter/star variant suffix) when available.
  const base = pool.find((c) => BASE_PRINTING.test(c.card_id));
  return (base || pool[0]).card_id;
}

async function resolveOne(name, category) {
  let candidates = await searchByName(name).catch(() => []);
  const lower = matchName(name);
  let hasExact = candidates.some((c) => matchName(c.name) === lower);
  let chosen = pickDefault(candidates, name);

  // Legends are listed as "Champion, Title" in decklists but stored as just
  // "Title" in the database. If the full name has no exact match, retry with
  // the part after the first comma and prefer that exact match.
  if (category === "legend" && !hasExact && name.includes(",")) {
    const title = name.split(",").slice(1).join(",").trim();
    if (title.length >= 2) {
      const alt = await searchByName(title).catch(() => []);
      const altExact = alt.some((c) => matchName(c.name) === matchName(title));
      if (altExact) {
        candidates = alt;
        chosen = pickDefault(alt, title);
        hasExact = true;
      }
    }
  }

  return { candidates, chosen, ambiguous: !chosen || !hasExact };
}

/**
 * Resolve every parsed entry against the RiftScribe search API.
 * Returns the same category structure, each entry enriched with
 * { quantity, name, candidates, chosen, ambiguous }.
 */
export async function resolveDecklist(parsed) {
  const out = {};
  for (const [category, entries] of Object.entries(parsed)) {
    out[category] = [];
    for (const entry of entries) {
      const r = await resolveOne(entry.name, category);
      out[category].push({ quantity: entry.quantity, name: entry.name, ...r });
    }
  }
  return out;
}

/**
 * Resolve a Tabletop Simulator decklist (also produced by Piltover Archive's
 * one-click TTS export): a flat, whitespace-separated list of card ids, each
 * repeated once per copy (e.g. "OGN-245-1 OGN-245-1 OGN-245-1 ...").
 * Cards are categorized by their API type; champion/sideboard cannot be
 * distinguished from a flat list and are left for the operator to adjust.
 */
export async function resolveTTS(text) {
  const counts = new Map();
  for (const token of String(text || "").split(/\s+/)) {
    const m = token.trim().match(/^([a-z]+)-(\d+[a-z]?)/i);
    if (!m) continue;
    const id = `${m[1]}-${m[2]}`.toLowerCase();
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const out = { legend: [], champions: [], maindeck: [], battlefields: [], runes: [], sideboard: [] };
  for (const [id, quantity] of counts) {
    let detail = null;
    try {
      detail = await fetchCardDetail(id);
    } catch {
      detail = null;
    }
    if (!detail) {
      out.maindeck.push({ quantity, name: id, candidates: [], chosen: null, ambiguous: true });
      continue;
    }
    const cand = {
      card_id: detail.id,
      name: detail.name,
      type: detail.type,
      set_id: detail.set_id,
      thumbnail_url: detail.image_thumb?.small,
    };
    const entry = { quantity, name: detail.name, candidates: [cand], chosen: detail.id, ambiguous: false };
    if (detail.type === "Legend") out.legend.push(entry);
    else if (detail.type === "Battlefield") out.battlefields.push(entry);
    else if (detail.type === "Rune") out.runes.push(entry);
    else out.maindeck.push(entry);
  }
  return out;
}
