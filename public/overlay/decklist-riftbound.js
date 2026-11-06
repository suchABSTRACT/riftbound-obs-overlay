// Riftbound decklist screen ("Spotlight", Filigree style). One player's deck,
// full screen, on a transparent background so a scene background shows
// through in OBS:
//   left  — the Legend's art fading in, Champion card, "Decklist", the player
//           name (shrinks to fit one line), Legend · Champion, record, rune
//           counts and the three battlefields;
//   right — Main deck panel (cards with copy bubbles, sized to fill the panel)
//           and a Sideboard panel (room for 10 different cards), which the
//           "Decklist sideboard" show-toggle turns off.
// Laid out in design pixels at 1920×1080; --p scales it to the source size.

import { DOMAIN_COLORS, fils, shape } from "./broadcast-panels.js";
import { bfFramingFor, bfImgHtml, fitAllBfImgs, watchBfImgs } from "/shared/artFraming.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const img = (c) => c?.thumbLocal || c?.imageLocal || "";
const big = (c) => c?.imageLocal || c?.thumbLocal || "";
const CARD_RATIO = 1039 / 744;
const BUBBLE = 16; // copy bubble hangs this far below a card

// Panel inner boxes (design px) — keep in sync with decklist-riftbound.css.
const MAIN_W = 1028;
const MAIN_H = { side: 610, noside: 920 };
const SIDE_W = 1028;
const SIDE_H = 196;

/**
 * Columns that give the biggest cards while every card fits both the width
 * and the height of the box (ties go to more columns, so rows fill first).
 */
export function fitGrid(n, w, h, { gap = 16, max = 170, min = 50 } = {}) {
  if (!n) return { cols: 1, card: max };
  let best = { cols: 1, card: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const byW = (w - (cols - 1) * gap) / cols;
    const byH = ((h - (rows - 1) * gap) / rows - BUBBLE) / CARD_RATIO;
    const card = Math.min(max, byW, byH);
    if (card >= best.card) best = { cols, card };
  }
  return { cols: best.cols, card: Math.max(min, Math.floor(best.card)) };
}

function deckPlayer(state) {
  const pid = state.display?.broadcast?.decklist?.player === "p2" ? "p2" : "p1";
  return { pid, i: pid === "p1" ? 0 : 1, player: state.players?.[pid === "p1" ? 0 : 1] || {} };
}

function sideOn(state) {
  return state.display?.broadcast?.show?.sideboard !== false;
}

function panel(cls, label, count, inner, corners = ["tl", "br"]) {
  const cnt = count != null ? `<em>${count}</em>` : "";
  return (
    `<section class="dl-tp ${cls}">${shape("dl-tp-sh tex-grain", "")}` +
    `<div class="dl-tab">${shape("dl-tab-sh tex-grain", `<span>${label}${cnt}</span>`)}</div>` +
    `<div class="dl-tp-in">${inner}</div>${fils(...corners)}</section>`
  );
}

function cardsHtml(list, fit, extra = "") {
  const cards = list
    .map(
      (c) =>
        `<div class="dl-qc${extra}"><div class="dl-cd">${img(c) ? `<img src="${img(c)}" alt="" />` : `<span>${esc(c.name || "")}</span>`}</div><b class="dl-qb">${c.q}</b></div>`
    )
    .join("");
  return `<div class="dl-grid" style="--cols:${fit.cols};--card:${fit.card}">${cards}</div>`;
}

function runesHtml(runes = []) {
  return runes
    .map(
      (r) =>
        `<span class="dl-rn" style="--c:${DOMAIN_COLORS[r.domain] || "#8a93b3"}"><i><b></b></i>×${r.count}</span>`
    )
    .join("");
}

function bfsHtml(state, player) {
  const framing = state.display?.broadcast?.framing;
  return (player.battlefields || [])
    .slice(0, 3)
    .map(
      (b) =>
        `<div class="dl-bf"><div class="dl-bf-art">${big(b) ? bfImgHtml(big(b), bfFramingFor(b.id, framing)) : ""}</div><span>${esc(b.name || "")}</span></div>`
    )
    .join("");
}

/** Identity: a change here replays the entrance (other changes update in place). */
export function dlIdentity(state) {
  const { pid, player } = deckPlayer(state);
  const hasSide = (player.decklist?.side || []).length > 0;
  return ["dl", pid, player.pseudo, big(player.legend), sideOn(state) && hasSide ? 1 : 0].join("|");
}

function bodyHtml(state) {
  const { player } = deckPlayer(state);
  const d = player.decklist || { main: [], side: [], runes: [], mainCount: 0, sideCount: 0 };
  // No sideboard cards → no sideboard panel; the main deck takes the room.
  const withSide = sideOn(state) && d.side.length > 0;
  const mainFit = fitGrid(d.main.length, MAIN_W, withSide ? MAIN_H.side : MAIN_H.noside, { gap: 18, max: withSide ? 150 : 175 });
  const sideFit = fitGrid(Math.max(1, d.side.length), SIDE_W, SIDE_H, { gap: 12, max: 140 });
  const legend = player.legend;
  const champ = player.champion;
  const subtitle = [legend?.name, champ?.name].filter(Boolean).map(esc).join(" · ");
  const a = (cls, delay, dur = 0.7) => `mp-item ${cls}" style="--mp-delay:${delay}ms;--mp-duration:${dur}s`;

  return `
    <div class="dl-art ${a("mx-a-fade", 0, 0.8)}">${big(legend) ? `<img src="${big(legend)}" alt="" />` : ""}</div>
    ${champ && big(champ) ? `<div class="dl-ch ${a("dl-a-card", 350, 0.9)}"><img src="${big(champ)}" alt="" /></div>` : ""}
    <div class="dl-id ${a("mx-a-rise", 200, 0.7)}" data-dl="id">
      <span class="dl-k">Decklist</span>
      <span class="dl-n" data-dl="name">${esc(player.pseudo || "")}</span>
      ${subtitle ? `<span class="dl-s">${subtitle}</span>` : ""}
      ${player.record ? `<span class="dl-r">${esc(player.record)}</span>` : ""}
      ${d.runes.length ? `<div class="dl-runes"><span class="dl-lbl">Runes</span>${runesHtml(d.runes)}</div>` : ""}
      ${(player.battlefields || []).length ? `<span class="dl-lbl dl-bfl">Battlefields</span><div class="dl-bfs">${bfsHtml(state, player)}</div>` : ""}
    </div>
    <div class="dl-main-w ${a("mx-a-rise", 300, 0.7)}">
      ${panel(`dl-main${withSide ? "" : " tall"}`, "Main deck", d.mainCount, cardsHtml(d.main, mainFit))}
    </div>
    ${
      withSide
        ? `<div class="dl-side-w ${a("mx-a-rise", 450, 0.7)}">${panel("dl-side", "Sideboard", d.sideCount, cardsHtml(d.side, sideFit, " s"))}</div>`
        : ""
    }`;
}

/** Shrink the player name until it fits on one line. */
function fitName(root) {
  const el = root.querySelector('[data-dl="name"]');
  if (!el) return;
  el.style.fontSize = "";
  let size = 112;
  const run = () => {
    el.style.fontSize = `calc(var(--p) * ${size})`;
    if (el.scrollWidth > el.clientWidth + 1 && size > 48) {
      size -= 4;
      requestAnimationFrame(run);
    }
  };
  run();
}

export function dlBuild(root, state) {
  watchBfImgs(root);
  root.innerHTML = `<div class="dl-root bx">${bodyHtml(state)}</div>`;
  fitAllBfImgs(root);
  fitName(root);
  document.fonts?.ready?.then(() => fitName(root));
}

/** Live update (deck saved, record changed, framing…) without replaying the entrance. */
export function dlUpdate(root, state) {
  const host = root.querySelector(".dl-root");
  if (!host) return dlBuild(root, state);
  const html = bodyHtml(state).replace(/ mp-item [^"]*"( style="[^"]*")?/g, ' mp-item mp-settled"');
  if (host.dataset.html === html) return;
  host.dataset.html = html;
  host.innerHTML = html;
  fitAllBfImgs(host);
  fitName(host);
}
