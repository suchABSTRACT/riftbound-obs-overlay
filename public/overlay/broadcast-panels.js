// Broadcast overlay blocks in the "Filigree" style (canvas round 5):
// player panels (first/second, legend + champion art, XP, legend + champion
// names, hand size), rune pool (segments in domain colours), and the scoreboard
// (grain name plates, centre counter with games won / round / clock, and a tray
// of game-result slots). Each block is a layout slot; styles scale with it.

import { artStyle, framingFor } from "/shared/artFraming.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const img = (card) => card?.imageLocal || card?.thumbLocal || "";

// Riftbound domain colours for rune segments.
export const DOMAIN_COLORS = {
  fury: "#e0483a",
  calm: "#3fb46d",
  mind: "#3e8ff0",
  body: "#ee8b2b",
  chaos: "#9a5ee6",
  order: "#e9c43c",
};

const HAND_ICON =
  '<svg aria-hidden="true" viewBox="0 0 20 20" class="ic"><rect x="3" y="5" width="8" height="12" rx="1"/><path d="M8 3.5l7.6 1.6-2.3 11.3"/></svg>';
const RUNE_ICON =
  '<svg aria-hidden="true" viewBox="0 0 20 20" class="ic"><path d="M10 2l6 8-6 8-6-8z"/><path d="M10 6v8M7.5 10h5"/></svg>';
const FIL =
  '<svg aria-hidden="true" class="fil {c}" viewBox="0 0 60 60"><path d="M2 58V20C2 10 10 2 20 2h38"/><path d="M8 52V24c0-9 7-16 16-16h28"/><path d="M14 30c0-9 7-16 16-16 0 9-7 16-16 16z"/><circle cx="34" cy="10" r="2.2"/><circle cx="10" cy="34" r="2.2"/></svg>';
const fils = (...corners) => corners.map((c) => FIL.replace("{c}", c)).join("");

/** Layered shape: metallic gold edge > fill > faint inner hairline > textured fill. */
const shape = (cls, inner) =>
  `<div class="sh ${cls}"><i class="sh-a"></i><i class="sh-b"></i><i class="sh-c"></i>${inner}</div>`;

function bc(state) {
  return state.display?.broadcast || { show: {}, timer: null, roundLabel: "" };
}
function shown(state, key) {
  return bc(state).show?.[key] !== false;
}
function stats(state, pid) {
  return state.game?.stats?.[pid] || { hand: 0, level: 0, runes: {} };
}
function playerName(state, i) {
  return state.players?.[i]?.pseudo || `Player ${i + 1}`;
}
function championOf(state, pid, i) {
  return state.game?.champion?.[pid] || state.players?.[i]?.champion || null;
}

// ---- player panel ----------------------------------------------------------------

function panelHtml(state, i) {
  const pid = i === 0 ? "p1" : "p2";
  const side = i === 0 ? "l" : "r";
  const p = state.players?.[i] || {};
  const st = stats(state, pid);
  const first = state.game?.first;
  const order = first ? (first === pid ? "First" : "Second") : "";
  const champ = championOf(state, pid, i);
  const framing = bc(state).framing || {};
  const legendArt = img(p.legend);
  const champArt = img(champ);
  const inner = `
    ${legendArt ? `<div class="pp-art pp-legend" style='${artStyle(legendArt, framingFor(p.legend?.id, framing))}'></div>` : ""}
    ${champArt ? `<div class="pp-art pp-champ" style='${artStyle(champArt, framingFor(champ?.id, framing))}'></div>` : ""}
    ${shown(state, "first") && order ? `<div class="pp-order ${order.toLowerCase()}"><span>${order}</span></div>` : ""}
    ${shown(state, "level") ? `<div class="pp-lv"><span>XP</span><b>${st.level ?? 0}</b></div>` : ""}
    <div class="pp-info">
      <div class="pp-l1">${esc(p.legend?.name || "Legend")}</div>
      <div class="pp-l2">${esc(champ?.name || "Champion")}</div>
      ${shown(state, "hand") ? `<div class="pp-stat">${HAND_ICON}<em>Hand</em><b>${st.hand ?? 0}</b></div>` : ""}
    </div>`;
  const flourishes = side === "l" ? fils("tr", "bl") : fils("tl", "br");
  return `<div class="bx"><div class="ppw ppw-${side}">${shape(`pp pp-${side}`, inner)}${flourishes}</div></div>`;
}

// ---- rune pool (segments) ----------------------------------------------------------------

/** Runes on the board, grouped by domain: ready ones first, then exhausted. */
export function runeSegments(domains = [], runes = {}) {
  const segs = [];
  let ready = 0;
  let total = 0;
  const order = [...domains, ...Object.keys(runes).filter((d) => !domains.includes(d))];
  for (const d of order) {
    const r = runes[d] || {};
    const t = Math.max(0, r.total || 0);
    const k = Math.min(t, Math.max(0, r.ready || 0));
    total += t;
    ready += k;
    for (let n = 0; n < t; n++) segs.push({ domain: d, on: n < k });
  }
  return { segs, ready, total };
}

function runesHtml(state, i) {
  const pid = i === 0 ? "p1" : "p2";
  const side = i === 0 ? "l" : "r";
  if (!shown(state, "runes")) return "";
  const { segs, ready, total } = runeSegments(state.players?.[i]?.runeDomains || [], stats(state, pid).runes || {});
  const cells = segs
    .slice(0, 12)
    .map((s) => `<i class="seg ${s.on ? "on" : "off"}" style="--c:${DOMAIN_COLORS[s.domain] || "#8a93b3"}"></i>`)
    .join("");
  const empty = '<i class="seg empty"></i>'.repeat(Math.max(0, 12 - Math.min(12, segs.length)));
  return `<div class="bx bx-rn"><div class="rn rn-seg rn-${side}"><span class="rn-n">${RUNE_ICON}<b>${ready}</b>/${total}</span><span class="rn-row">${cells}${empty}</span></div></div>`;
}

// ---- scoreboard --------------------------------------------------------------------------

function resultsHtml(state) {
  if (!shown(state, "results")) return "";
  const history = state.match?.history || [];
  const n = state.match?.gameCount || history.length || 3;
  const current = state.match?.winner ? -1 : state.match?.currentGame ?? 0;
  const slots = [];
  for (let g = 0; g < n; g++) {
    const w = history[g]?.winner;
    const cls = w === "p1" ? "won-p1" : w === "p2" ? "won-p2" : "open";
    slots.push(`<i class="gslot ${cls}${g === current ? " now" : ""}"></i>`);
  }
  return `<div class="rb gslots">${slots.join("")}</div>`;
}

function scoreboardHtml(state) {
  const b = bc(state);
  const won = state.match?.score || { p1: 0, p2: 0 };
  const fmt = String(state.match?.format || "bo3").replace(/^bo/i, "Bo");
  const tab = state.match?.winner ? `Final · ${fmt}` : `Game ${(state.match?.currentGame ?? 0) + 1} · ${fmt}`;
  const plate = (i) => {
    const rec = state.players?.[i]?.record;
    return `<div class="pw pw-${i === 0 ? "l" : "r"}">${shape(
      `plate plate-${i === 0 ? "l" : "r"} tex-grain`,
      `<span class="nm">${esc(playerName(state, i))}</span>${shown(state, "record") && rec ? `<span class="rec">${esc(rec)}</span>` : ""}`
    )}</div>`;
  };
  const counter = shape(
    "ctr tex-grain",
    `<span class="tab">${tab}</span>
     <span class="sc"><b>${won.p1}</b><i>:</i><b>${won.p2}</b></span>
     ${b.roundLabel ? `<span class="stg">${esc(b.roundLabel)}</span>` : ""}
     ${shown(state, "timer") ? `<span class="clk" data-clock>--:--</span>` : ""}`
  );
  return `
    <div class="bx bx-sb"><div class="sb">
      ${plate(0)}
      <div class="cw"><div class="ctrw">${counter}${fils("tl", "tr")}</div>${resultsHtml(state)}</div>
      ${plate(1)}
    </div></div>`;
}

export const PANEL_DEFS = {
  "p1.panel": (s) => panelHtml(s, 0),
  "p2.panel": (s) => panelHtml(s, 1),
  "p1.runes": (s) => runesHtml(s, 0),
  "p2.runes": (s) => runesHtml(s, 1),
  scoreboard: (s) => scoreboardHtml(s),
};

// ---- clock -------------------------------------------------------------------------------

let clockTimer = null;
let clockState = null;

function fmtClock(sec) {
  const neg = sec < 0;
  const s = Math.abs(neg ? Math.floor(sec) : Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${String(m).padStart(2, "0")}:${r}`;
  return neg ? `+${body}` : body;
}

function tickClock() {
  const t = clockState?.display?.broadcast?.timer;
  const els = document.querySelectorAll("[data-clock]");
  if (!t || !els.length) return;
  const left = t.startedAt ? t.remaining - (Date.now() - t.startedAt) / 1000 : t.remaining;
  const text = fmtClock(left);
  els.forEach((el) => {
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("running", Boolean(t.startedAt));
    el.classList.toggle("low", left <= 300 && left > 0);
    el.classList.toggle("over", left <= 0);
  });
}

export function updateClock(state) {
  clockState = state;
  tickClock();
  if (!clockTimer) clockTimer = setInterval(tickClock, 250);
}
