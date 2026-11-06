// Riftbound matchup screen in the "Filigree" style of the in-game overlay:
// two player-camera windows framed with a thin metallic gold hairline and
// corner flourishes, the same scoreboard as in-game (grain name plates, game
// counter, result slots), a grain info plate + Legend / Champion cards per
// player, and a battlefield strip along the bottom. Each battlefield shows its
// art with its name and rules text; the battlefield a player won on gets a
// green border.
//
// Camera windows are transparent and sit exactly where they always have, so
// existing OBS camera sources keep lining up:
//   left  x 0.25vw → 49.75vw,  y 0 → 77.6vh
//   right x 50.25vw → 99.75vw, y 0 → 77.6vh

import { PANEL_DEFS, fils, shape } from "./broadcast-panels.js";
import { bfFramingFor, bfImgHtml, fitAllBfImgs, watchBfImgs } from "/shared/artFraming.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PIDS = ["p1", "p2"];

// Entrance timings (ms).
const T = {
  frames: 0,
  plates: 200,
  info: 550,
  legend: 700,
  champion: 850,
  strip: 1000,
  tileStagger: 80,
};

function imgOf(card) {
  return card?.imageLocal || card?.thumbLocal || "";
}
function championFor(state, pid, i) {
  return state.game?.champion?.[pid] || state.players?.[i]?.champion || null;
}
function shown(state, key) {
  return state.display?.broadcast?.show?.[key] !== false;
}

/** Identity of the screen: a change here replays the full entrance. */
export function mxIdentity(state) {
  const parts = [state.match?.format, state.match?.gameCount];
  (state.players || []).forEach((p) => parts.push(p?.pseudo || "", imgOf(p?.legend)));
  return parts.join("|");
}

const anim = (cls, delay, dur) => `mp-item ${cls}" style="--mp-delay:${delay}ms;--mp-duration:${dur}s`;

// ---- player info plate + cards ---------------------------------------------------

function infoHtml(state, i) {
  const pid = PIDS[i];
  const side = i === 0 ? "l" : "r";
  const first = state.game?.first;
  const order = first ? (first === pid ? "First" : "Second") : "";
  const legend = state.players?.[i]?.legend;
  const champ = championFor(state, pid, i);
  const inner = `
    ${shown(state, "first") && order ? `<span class="mx-order ${order.toLowerCase()}"><span>${order}</span></span>` : ""}
    <span class="mx-info-text">
      <span class="mx-info-legend">${esc(legend?.name || "Legend")}</span>
      <span class="mx-info-champ">${esc(champ?.name || "Champion")}</span>
    </span>`;
  return `${shape(`mxi mxi-${side} tex-grain`, inner)}${side === "l" ? fils("tl", "br") : fils("tr", "bl")}`;
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

// ---- battlefield strip ------------------------------------------------------------

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
  const bf = h.battlefield?.[pid];
  const cur = state.match?.currentGame === g && !state.match?.winner;
  const f = bf?.id ? Object.values(bfFramingFor(bf.id, state.display?.broadcast?.framing)).join(",") : "";
  return [pid, g, bf?.id || "", (bf?.text || "").length, h.winner || "", cur ? 1 : 0, f].join(":");
}

/** Rules text → HTML: keywords in [brackets] bold, line breaks kept. */
function rulesHtml(text) {
  return esc(text)
    .replace(/\[([^\]]{1,24})\]/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
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
  const name = bf ? esc(bf.name || "") : isCurrent ? "Not picked yet" : played ? "—" : "Not played";
  return `
    <div class="${cls}${animAttr}" data-key="${esc(tileKey(state, t))}">
      <div class="mx-art">${bf && imgOf(bf) ? bfImgHtml(imgOf(bf), bfFramingFor(bf.id, state.display?.broadcast?.framing)) : ""}</div>
      <div class="mx-bf">
        <span class="mx-bf-name">${name}</span>
        ${bf?.text ? `<span class="mx-bf-text">${rulesHtml(bf.text)}</span>` : ""}
      </div>
      <span class="mx-gtab">${isCurrent ? "Now · " : ""}Game ${g + 1}</span>
      ${result === "win" ? `<span class="mx-won">Won</span>` : ""}
    </div>`;
}

function stripInner(state, animate) {
  return tileList(state)
    .map((t) => tileHtml(state, t, animate ? T.strip + t.g * T.tileStagger : null))
    .join("");
}

// ---- public API --------------------------------------------------------------------

export function mxBuild(root, state) {
  watchBfImgs(root);
  const n = state.match?.gameCount || 3;
  root.innerHTML = `
    <div class="mx-root bx">
      <div class="mx-cam mx-cam-l ${anim("mx-a-fade", T.frames, 0.5)}">${fils("tl", "bl")}</div>
      <div class="mx-cam mx-cam-r ${anim("mx-a-fade", T.frames, 0.5)}">${fils("tr", "br")}</div>

      <div class="mx-sb ${anim("mx-a-drop", T.plates, 0.7)}" data-mx="sb">${PANEL_DEFS.scoreboard(state)}</div>

      <div class="mx-infow mx-infow-l ${anim("mx-a-rise", T.info, 0.6)}" data-mx="info-0">${infoHtml(state, 0)}</div>
      <div class="mx-infow mx-infow-r ${anim("mx-a-rise", T.info, 0.6)}" data-mx="info-1">${infoHtml(state, 1)}</div>
      <div class="mx-hand mx-hand-l" data-mx="hand-0">${handInner(state, 0)}</div>
      <div class="mx-hand mx-hand-r" data-mx="hand-1">${handInner(state, 1)}</div>

      <div class="mx-strip${n > 3 ? " dense" : ""} ${anim("mx-a-fade", T.strip - 200, 0.5)}">
        <div class="mx-tiles" data-mx="strip" style="--mx-tiles:${n * 2}">${stripInner(state, true)}</div>
      </div>
    </div>`;
  fitAllBfImgs(root);
}

/**
 * Live update while the screen is up (score, game change, battlefield pick,
 * champion swap, first player, records) without replaying the entrance. Only
 * tiles / cards that actually changed get a small flip-in.
 */
export function mxUpdate(root, state) {
  const set = (sel, html) => {
    const el = root.querySelector(sel);
    if (el && el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
  };
  set('[data-mx="sb"]', PANEL_DEFS.scoreboard(state));
  [0, 1].forEach((i) => {
    set(`[data-mx="info-${i}"]`, infoHtml(state, i));
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
    strip.parentElement.classList.toggle("dense", tiles.length > 6);
    strip.innerHTML = stripInner(state, false);
    fitAllBfImgs(strip);
    return;
  }
  tiles.forEach((t, idx) => {
    const el = existing[idx];
    if (el.dataset.key === tileKey(state, t)) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = tileHtml(state, t, null).trim();
    const fresh = tmp.firstElementChild;
    el.replaceWith(fresh);
    fitAllBfImgs(fresh);
    flash(fresh);
  });
}

function flash(el) {
  if (!el) return;
  el.classList.remove("mx-flip");
  void el.offsetWidth;
  el.classList.add("mx-flip");
}
