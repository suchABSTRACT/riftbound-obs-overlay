// Broadcast overlay blocks: player panels, scoreboard + clock, rune tracks.
// Each block is a normal layout slot (drag/resize in the Layout tab); the
// content scales with the slot box via container query units (see CSS).

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const img = (card) => card?.imageLocal || card?.thumbLocal || "";

function bc(state) {
  return state.display?.broadcast || { show: {}, timer: null, roundLabel: "" };
}
function shown(state, key) {
  return bc(state).show?.[key] !== false;
}
function stats(state, pid) {
  return state.game?.stats?.[pid] || { hand: 0, gold: 0, level: 0, runesReady: 0, runesTotal: 0 };
}
function playerName(state, i) {
  return state.players?.[i]?.pseudo || `Player ${i + 1}`;
}
function championOf(state, pid, i) {
  return state.game?.champion?.[pid] || state.players?.[i]?.champion || null;
}

const ICON = {
  legend: `<svg viewBox="0 0 16 16"><path d="M8 1l2 4.5 4.8.4-3.6 3.2 1.1 4.8L8 11.4l-4.3 2.5 1.1-4.8L1.2 5.9 6 5.5z"/></svg>`,
  champion: `<svg viewBox="0 0 16 16"><path d="M8 1l6 3v4c0 3.4-2.6 6.2-6 7-3.4-.8-6-3.6-6-7V4z"/></svg>`,
  hand: `<svg viewBox="0 0 16 16"><rect x="2" y="3" width="8" height="11" rx="1.2"/><rect x="6" y="2" width="8" height="11" rx="1.2" opacity=".55"/></svg>`,
  gold: `<svg viewBox="0 0 16 16"><ellipse cx="8" cy="5" rx="6" ry="2.6"/><path d="M2 5v6c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V5c0 1.4-2.7 2.6-6 2.6S2 6.4 2 5z" opacity=".7"/></svg>`,
  rune: `<svg viewBox="0 0 16 16"><path d="M8 .8l6.2 7.2L8 15.2 1.8 8z"/></svg>`,
};

// ---- player panel ----------------------------------------------------------------

function panelHtml(state, i) {
  const pid = i === 0 ? "p1" : "p2";
  const p = state.players?.[i] || {};
  const st = stats(state, pid);
  const first = state.game?.first;
  const order = first ? (first === pid ? "First" : "Second") : "";
  const champ = championOf(state, pid, i);
  return `
    <div class="bp bp-${pid}">
      ${shown(state, "first") && order ? `<div class="bp-order ${order.toLowerCase()}"><span>${order}</span></div>` : ""}
      <div class="bp-portrait">
        ${img(p.legend) ? `<img src="${img(p.legend)}" alt="" />` : `<div class="bp-portrait-empty"></div>`}
        ${shown(state, "level") ? `<div class="bp-level"><span>LV</span><b>${st.level}</b></div>` : ""}
      </div>
      <div class="bp-info">
        ${champ && img(champ) ? `<img class="bp-champ-art" src="${img(champ)}" alt="" />` : ""}
        <div class="bp-line bp-legend">${ICON.legend}<span>${esc(p.legend?.name || "Legend")}</span></div>
        <div class="bp-line bp-champion">${ICON.champion}<span>${esc(champ?.name || "Champion")}</span></div>
        <div class="bp-stats">
          ${shown(state, "hand") ? `<span class="bp-stat">${ICON.hand}<em>Hand</em><b>${st.hand}</b></span>` : ""}
          ${shown(state, "gold") ? `<span class="bp-stat bp-gold">${ICON.gold}<em>Gold</em><b>${st.gold}</b></span>` : ""}
        </div>
      </div>
    </div>`;
}

// ---- rune track ----------------------------------------------------------------------

function runesHtml(state, i) {
  const pid = i === 0 ? "p1" : "p2";
  if (!shown(state, "runes")) return "";
  const { runesReady: ready, runesTotal: total } = stats(state, pid);
  const pips = [];
  for (let k = 0; k < 12; k++) {
    const cls = k < ready ? "ready" : k < total ? "spent" : "empty";
    pips.push(`<i class="rp ${cls}">${ICON.rune}</i>`);
  }
  return `
    <div class="br br-${pid}">
      <span class="br-icon">${ICON.rune}</span>
      <span class="br-count"><b>${ready}</b>/${total}</span>
      <span class="br-pips">${pips.join("")}</span>
    </div>`;
}

// ---- scoreboard --------------------------------------------------------------------------

function crest(pid) {
  return `<svg class="bs-crest bs-crest-${pid}" viewBox="0 0 40 32"><path d="M20 2l4 9 10-5-5 11 9 2-11 4 3 7-10-5-10 5 3-7-11-4 9-2-5-11 10 5z"/></svg>`;
}

function scoreboardHtml(state) {
  const b = bc(state);
  const pts = state.game?.score || { p1: 0, p2: 0 };
  const won = state.match?.score || { p1: 0, p2: 0 };
  const side = (i) => {
    const pid = i === 0 ? "p1" : "p2";
    const rec = state.players?.[i]?.record;
    return `
      <div class="bs-side bs-${pid}">
        ${crest(pid)}
        <div class="bs-who">
          <span class="bs-name">${esc(playerName(state, i))}</span>
          ${shown(state, "record") && rec ? `<span class="bs-record">${esc(rec)}</span>` : ""}
        </div>
        ${shown(state, "points") ? `<span class="bs-points">${pts[pid]}</span>` : ""}
      </div>`;
  };
  const meta = [b.roundLabel, shown(state, "gamesWon") ? `${won.p1}–${won.p2}` : ""].filter(Boolean).join(" · ");
  return `
    <div class="bs">
      ${side(0)}
      <div class="bs-mid">
        ${meta ? `<span class="bs-round">${esc(meta)}</span>` : ""}
        ${shown(state, "timer") ? `<span class="bs-clock" data-clock>--:--</span>` : ""}
      </div>
      ${side(1)}
    </div>`;
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
