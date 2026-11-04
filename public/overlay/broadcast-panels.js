// Broadcast overlay blocks in the "Broadcast standard" style (mockup A):
// player panels (first/second, legend art, champion art, level, legend +
// champion names, hand size) and the scoreboard (names, records, game tab,
// games won, round name, clock). Each block is a normal layout slot; the
// styles scale with the slot box (see broadcast-panels.css).

import { artStyle, framingFor } from "/shared/artFraming.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const img = (card) => card?.imageLocal || card?.thumbLocal || "";

const HAND_ICON =
  '<svg aria-hidden="true" viewBox="0 0 20 20" class="ic"><rect x="3" y="5" width="8" height="12" rx="1"/><path d="M8 3.5l7.6 1.6-2.3 11.3"/></svg>';

function bc(state) {
  return state.display?.broadcast || { show: {}, timer: null, roundLabel: "" };
}
function shown(state, key) {
  return bc(state).show?.[key] !== false;
}
function stats(state, pid) {
  return state.game?.stats?.[pid] || { hand: 0, level: 0 };
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
  const legendArt = img(p.legend);
  const champArt = img(champ);
  const framing = bc(state).framing || {};
  return `
    <div class="bx">
      <div class="pp pp-${side}">
        ${legendArt ? `<div class="pp-legend" style='${artStyle(legendArt, framingFor(p.legend?.id, framing))}'></div>` : ""}
        ${champArt ? `<div class="pp-champ" style='${artStyle(champArt, framingFor(champ?.id, framing))}'></div>` : ""}
        ${shown(state, "first") && order ? `<div class="pp-order ${order.toLowerCase()}"><span>${order}</span></div>` : ""}
        ${shown(state, "level") ? `<div class="pp-lv"><span>LV</span><b>${st.level ?? 0}</b></div>` : ""}
        <div class="pp-info">
          <div class="pp-row pp-row-legend"><span>${esc(p.legend?.name || "Legend")}</span></div>
          <div class="pp-row pp-row-champ"><span>${esc(champ?.name || "Champion")}</span></div>
          ${
            shown(state, "hand")
              ? `<div class="pp-stats"><span class="pp-stat">${HAND_ICON}<em>Hand</em><b>${st.hand ?? 0}</b></span></div>`
              : ""
          }
        </div>
      </div>
    </div>`;
}

// ---- scoreboard --------------------------------------------------------------------------

function scoreboardHtml(state) {
  const b = bc(state);
  const won = state.match?.score || { p1: 0, p2: 0 };
  const gameNo = (state.match?.currentGame ?? 0) + 1;
  const plate = (i) => {
    const pid = i === 0 ? "p1" : "p2";
    const rec = state.players?.[i]?.record;
    return `
      <div class="sb-plate sb-${i === 0 ? "l" : "r"}">
        <div class="sb-who">
          <span class="sb-name">${esc(playerName(state, i))}</span>
          ${shown(state, "record") && rec ? `<span class="sb-rec">${esc(rec)}</span>` : ""}
        </div>
      </div>`;
  };
  return `
    <div class="bx bx-sb">
      <div class="sb">
        ${plate(0)}
        <div class="sb-mid">
          <span class="sb-tab">Game ${gameNo}</span>
          <span class="sb-score"><b>${won.p1}</b><i>:</i><b>${won.p2}</b></span>
          ${b.roundLabel ? `<span class="sb-stage">${esc(b.roundLabel)}</span>` : ""}
          ${shown(state, "timer") ? `<span class="sb-clock" data-clock>--:--</span>` : ""}
        </div>
        ${plate(1)}
      </div>
    </div>`;
}

export const PANEL_DEFS = {
  "p1.panel": (s) => panelHtml(s, 0),
  "p2.panel": (s) => panelHtml(s, 1),
  scoreboard: (s) => scoreboardHtml(s),
};

// ---- clock -------------------------------------------------------------------------------

let clockTimer = null;
let clockState = null;

function fmt(sec) {
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
  const text = fmt(left);
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
