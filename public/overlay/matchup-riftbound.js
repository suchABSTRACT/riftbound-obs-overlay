// Riftbound matchup screen, in the same "Broadcast standard" style as the
// in-game overlay: two player-camera windows framed with thin gold double
// rules, the blue/red name plates + centre score box across the top, each
// player's Legend + Champion cards with a name plate, and a game strip along
// the bottom with every game's battlefield (P1 left, P2 right, Game 1 in the
// middle).
//
// Camera windows are transparent and sit exactly where they always have, so
// existing OBS camera sources keep lining up:
//   left  x 0.25vw → 49.75vw,  y 0 → 77.6vh
//   right x 50.25vw → 99.75vw, y 0 → 77.6vh

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PIDS = ["p1", "p2"];

// Entrance timings (ms).
const T = {
  frames: 0,
  plates: 200,
  mid: 450,
  info: 650,
  legend: 750,
  champion: 900,
  strip: 1050,
  tileStagger: 80,
};

function imgOf(card) {
  return card?.imageLocal || card?.thumbLocal || "";
}
function playerName(state, i) {
  return state.players?.[i]?.pseudo || `Player ${i + 1}`;
}
function championFor(state, pid, i) {
  return state.game?.champion?.[pid] || state.players?.[i]?.champion || null;
}
function bc(state) {
  return state.display?.broadcast || { show: {} };
}
function shown(state, key) {
  return bc(state).show?.[key] !== false;
}

/** Identity of the screen: a change here replays the full entrance. */
export function mxIdentity(state) {
  const parts = [state.match?.format, state.match?.gameCount];
  (state.players || []).forEach((p) => parts.push(p?.pseudo || "", imgOf(p?.legend)));
  return parts.join("|");
}

const anim = (cls, delay, dur) => `mp-item ${cls}" style="--mp-delay:${delay}ms;--mp-duration:${dur}s`;

// ---- top: plates + centre score box ---------------------------------------------

function plateInner(state, i) {
  const rec = state.players?.[i]?.record;
  return `
    <span class="mx-name">${esc(playerName(state, i))}</span>
    ${shown(state, "record") && rec ? `<span class="mx-rec">${esc(rec)}</span>` : ""}`;
}

function midInner(state) {
  const s = state.match?.score || { p1: 0, p2: 0 };
  const over = state.match?.winner;
  const g = (state.match?.currentGame ?? 0) + 1;
  const fmt = String(state.match?.format || "bo3").toUpperCase();
  const round = bc(state).roundLabel;
  return `
    <span class="mx-tab">${over ? "Final" : `Game ${g}`} · ${fmt}</span>
    <span class="mx-score"><b>${s.p1}</b><i>:</i><b>${s.p2}</b></span>
    ${round ? `<span class="mx-stage">${esc(round)}</span>` : ""}
    ${shown(state, "timer") ? `<span class="mx-clock" data-clock>--:--</span>` : ""}`;
}

// ---- player info plate + cards ---------------------------------------------------

function infoInner(state, i) {
  const pid = PIDS[i];
  const first = state.game?.first;
  const order = first ? (first === pid ? "First" : "Second") : "";
  const legend = state.players?.[i]?.legend;
  const champ = championFor(state, pid, i);
  return `
    ${shown(state, "first") && order ? `<span class="mx-order ${order.toLowerCase()}"><span>${order}</span></span>` : ""}
    <span class="mx-info-text">
      <span class="mx-info-legend">${esc(legend?.name || "Legend")}</span>
      <span class="mx-info-champ">${esc(champ?.name || "Champion")}</span>
    </span>`;
}

function handInner(state, i, animate = true) {
  const pid = PIDS[i];
  const side = i === 0 ? "l" : "r";
  const legend = imgOf(state.players?.[i]?.legend);
  const champ = imgOf(championFor(state, pid, i));
  const a = (d) => (animate ? anim(`mx-a-card-${side}`, d, 0.9) : "mp-item mp-settled");
  return `
    ${legend ? `<div class="mx-card mx-card-legend ${a(T.legend)}"><img src="${legend}" alt="" /><span class="mx-card-tag">Legend</span></div>` : ""}
    ${champ ? `<div class="mx-card mx-card-champion ${a(T.champion)}" data-mx="champ-${i}"><img src="${champ}" alt="" /><span class="mx-card-tag">Champion</span></div>` : ""}`;
}

// ---- game strip -------------------------------------------------------------------

/** Tile order: P1 games N…1 (Game 1 nearest the centre), then P2 games 1…N. */
function tileList(state) {
  const n = state.match?.gameCount || 3;
  const tiles = [];
  for (let g = n - 1; g >= 0; g--) tiles.push({ pid: "p1", g });
  for (let g = 0; g < n; g++) tiles.push({ pid: "p2", g });
  return tiles;
}

function tileKey(state, { pid, g }) {
  const h = state.match?.history?.[g] || {};
  const cur = state.match?.currentGame === g && !state.match?.winner;
  return [pid, g, h.battlefield?.[pid]?.id || "", h.winner || "", cur ? 1 : 0].join(":");
}

function tileHtml(state, t, delayMs) {
  const { pid, g } = t;
  const h = state.match?.history?.[g] || {};
  const bf = h.battlefield?.[pid] || null;
  const isCurrent = state.match?.currentGame === g && !state.match?.winner;
  const played = Boolean(h.winner);
  const result = played ? (h.winner === pid ? "win" : "loss") : "";
  const cls = [
    "mx-tile",
    `side-${pid}`,
    pid === "p1" && g === 0 ? "mid-left" : "",
    bf ? "has-bf" : "empty",
    isCurrent ? "current" : "",
    result,
  ]
    .filter(Boolean)
    .join(" ");
  const animAttr = delayMs == null ? "" : ` mp-item mx-a-tile" style="--mp-delay:${delayMs}ms;--mp-duration:.6s`;
  return `
    <div class="${cls}${animAttr}" data-key="${esc(tileKey(state, t))}">
      ${bf ? `<img src="${imgOf(bf)}" alt="" />` : ""}
      <div class="mx-tile-text">
        ${isCurrent ? `<span class="mx-tile-kicker">Current battlefield</span>` : ""}
        <span class="mx-tile-name">${bf ? esc(bf.name || "") : isCurrent ? "Not picked yet" : played ? "—" : "Not played"}</span>
      </div>
      ${result ? `<span class="mx-result">${result === "win" ? "Win" : "Loss"}</span>` : ""}
      <span class="mx-gtab">Game ${g + 1}</span>
    </div>`;
}

function stripInner(state, animate) {
  return tileList(state)
    .map((t) => tileHtml(state, t, animate ? T.strip + t.g * T.tileStagger : null))
    .join("");
}

// ---- public API --------------------------------------------------------------------

export function mxBuild(root, state) {
  const n = state.match?.gameCount || 3;
  root.innerHTML = `
    <div class="mx-root">
      <div class="mx-cam mx-cam-l ${anim("mx-a-fade", T.frames, 0.5)}"></div>
      <div class="mx-cam mx-cam-r ${anim("mx-a-fade", T.frames, 0.5)}"></div>
      <div class="mx-seam ${anim("mx-a-fade", T.frames, 0.5)}"></div>

      <div class="mx-top">
        <div class="mx-plate mx-plate-l ${anim("mx-a-plate-l", T.plates, 0.7)}" data-mx="plate-0">${plateInner(state, 0)}</div>
        <div class="mx-mid ${anim("mx-a-drop", T.mid, 0.6)}" data-mx="mid">${midInner(state)}</div>
        <div class="mx-plate mx-plate-r ${anim("mx-a-plate-r", T.plates, 0.7)}" data-mx="plate-1">${plateInner(state, 1)}</div>
      </div>

      <div class="mx-info mx-info-l ${anim("mx-a-rise", T.info, 0.6)}" data-mx="info-0">${infoInner(state, 0)}</div>
      <div class="mx-info mx-info-r ${anim("mx-a-rise", T.info, 0.6)}" data-mx="info-1">${infoInner(state, 1)}</div>
      <div class="mx-hand mx-hand-l" data-mx="hand-0">${handInner(state, 0)}</div>
      <div class="mx-hand mx-hand-r" data-mx="hand-1">${handInner(state, 1)}</div>

      <div class="mx-strip${n > 3 ? " dense" : ""}" data-mx="strip" style="--mx-tiles:${n * 2}">${stripInner(state, true)}</div>
    </div>`;
}

/**
 * Live update while the screen is up (score, game change, battlefield pick,
 * champion swap, first player, records) without replaying the entrance. Only
 * tiles / cards that actually changed get a small flip-in.
 */
export function mxUpdate(root, state) {
  const set = (sel, html) => {
    const el = root.querySelector(sel);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };
  set('[data-mx="mid"]', midInner(state));
  [0, 1].forEach((i) => {
    set(`[data-mx="plate-${i}"]`, plateInner(state, i));
    set(`[data-mx="info-${i}"]`, infoInner(state, i));
    const champImg = root.querySelector(`[data-mx="champ-${i}"] img`);
    const next = imgOf(championFor(state, PIDS[i], i));
    if (champImg && next && champImg.getAttribute("src") !== next) {
      champImg.src = next;
      flash(champImg.parentElement);
    } else if (!champImg && next) {
      const hand = root.querySelector(`[data-mx="hand-${i}"]`);
      if (hand) hand.innerHTML = handInner(state, i, false);
    }
  });

  const strip = root.querySelector('[data-mx="strip"]');
  if (!strip) return;
  const tiles = tileList(state);
  const existing = [...strip.querySelectorAll(".mx-tile")];
  if (existing.length !== tiles.length) {
    strip.style.setProperty("--mx-tiles", tiles.length);
    strip.classList.toggle("dense", tiles.length > 6);
    strip.innerHTML = stripInner(state, false);
    return;
  }
  tiles.forEach((t, idx) => {
    const el = existing[idx];
    if (el.dataset.key === tileKey(state, t)) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = tileHtml(state, t, null).trim();
    const fresh = tmp.firstElementChild;
    el.replaceWith(fresh);
    flash(fresh);
  });
}

function flash(el) {
  if (!el) return;
  el.classList.remove("mx-flip");
  void el.offsetWidth;
  el.classList.add("mx-flip");
}
