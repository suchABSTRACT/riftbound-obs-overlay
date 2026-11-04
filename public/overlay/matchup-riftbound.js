// Riftbound matchup screen: two player-camera windows, name banners, each
// player's Legend + Champion fanned over their camera, and a game strip along
// the bottom with every game's battlefield (P1 on the left, P2 on the right,
// Game 1 meeting in the middle).
//
// The camera windows are transparent: put the player cams in OBS underneath
// the Browser Source, sized to the frames (see MX_CAMS for the exact boxes).

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PIDS = ["p1", "p2"];

// Entrance timings (ms).
const T = {
  frames: 0,
  banners: 250,
  badge: 650,
  legend: 700,
  champion: 950,
  strip: 1200,
  tileStagger: 90,
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

function formatLabel(fmt) {
  return ({ bo1: "Bo1", bo3: "Bo3", bo5: "Bo5" }[fmt] || String(fmt || "Bo3")).toUpperCase();
}

/** Identity of the screen: a change here replays the full entrance. */
export function mxIdentity(state) {
  const parts = [state.match?.format, state.match?.gameCount];
  (state.players || []).forEach((p) => parts.push(p?.pseudo || "", imgOf(p?.legend)));
  return parts.join("|");
}

// ---- pieces ----------------------------------------------------------------

function camHtml(side) {
  return `
    <div class="mx-cam mx-cam-${side} mp-item mx-a-fade" style="--mp-delay:${T.frames}ms;--mp-duration:.6s">
      <i class="mx-corner tl"></i><i class="mx-corner tr"></i><i class="mx-corner bl"></i><i class="mx-corner br"></i>
    </div>`;
}

function bannerHtml(state, i) {
  const side = i === 0 ? "left" : "right";
  return `
    <div class="mx-banner mx-banner-${side} mp-item mx-a-banner-${side}" style="--mp-delay:${T.banners}ms;--mp-duration:.8s">
      <span class="mx-banner-name" data-mx="name-${i}">${esc(playerName(state, i))}</span>
    </div>`;
}

function badgeInner(state) {
  const s = state.match?.score || { p1: 0, p2: 0 };
  const g = (state.match?.currentGame ?? 0) + 1;
  const over = state.match?.winner;
  return `
    <span class="mx-badge-score"><b>${s.p1}</b><i>–</i><b>${s.p2}</b></span>
    <span class="mx-badge-meta">${formatLabel(state.match?.format)} · ${over ? "Final" : `Game ${g}`}</span>`;
}

function handInner(state, i) {
  const pid = PIDS[i];
  const legend = imgOf(state.players?.[i]?.legend);
  const champ = imgOf(championFor(state, pid, i));
  return `
    ${legend ? `<div class="mx-card mx-card-legend mp-item mx-a-card-${i === 0 ? "left" : "right"}" style="--mp-delay:${T.legend}ms;--mp-duration:1s"><img src="${legend}" alt="" /></div>` : ""}
    ${champ ? `<div class="mx-card mx-card-champion mp-item mx-a-card-${i === 0 ? "left" : "right"}" style="--mp-delay:${T.champion}ms;--mp-duration:1s" data-mx="champ-${i}"><img src="${champ}" alt="" /></div>` : ""}`;
}

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
  const result = h.winner ? (h.winner === pid ? "win" : "loss") : "";
  const cls = ["mx-tile", `side-${pid}`, pid === "p1" && g === 0 ? "mid-left" : "", bf ? "has-bf" : "empty", isCurrent ? "current" : "", result].filter(Boolean).join(" ");
  const anim = delayMs == null ? "" : `mp-item mx-a-tile`;
  const style = delayMs == null ? "" : `style="--mp-delay:${delayMs}ms;--mp-duration:.7s"`;
  return `
    <div class="${cls} ${anim}" ${style} data-key="${esc(tileKey(state, t))}">
      ${bf ? `<img src="${imgOf(bf)}" alt="" />` : `<div class="mx-portal"></div>`}
      ${
        bf
          ? `<div class="mx-tile-text">
               ${isCurrent ? `<span class="mx-tile-kicker">Current battlefield</span>` : ""}
               <span class="mx-tile-name">${esc(bf.name || "")}</span>
             </div>`
          : ""
      }
      ${result ? `<span class="mx-result">${result === "win" ? "Win" : "Loss"}</span>` : ""}
      <span class="mx-tab">Game ${g + 1}</span>
    </div>`;
}

function stripInner(state, animate) {
  return tileList(state)
    .map((t) => {
      // Stagger outward from the centre (Game 1) to the edges.
      const delay = animate ? T.strip + t.g * T.tileStagger : null;
      return tileHtml(state, t, delay);
    })
    .join("");
}

// ---- public API --------------------------------------------------------------

export function mxBuild(root, state) {
  root.innerHTML = `
    <div class="mx-root">
      ${camHtml("left")}${camHtml("right")}
      <div class="mx-seam mp-item mx-a-fade" style="--mp-delay:${T.frames}ms;--mp-duration:.6s"></div>
      ${bannerHtml(state, 0)}${bannerHtml(state, 1)}
      <div class="mx-badge mp-item mx-a-drop" style="--mp-delay:${T.badge}ms;--mp-duration:.7s" data-mx="badge">${badgeInner(state)}</div>
      <div class="mx-hand mx-hand-left" data-mx="hand-0">${handInner(state, 0)}</div>
      <div class="mx-hand mx-hand-right" data-mx="hand-1">${handInner(state, 1)}</div>
      <div class="mx-strip${(state.match?.gameCount || 3) > 3 ? " dense" : ""}" data-mx="strip" style="--mx-tiles:${(state.match?.gameCount || 3) * 2}">${stripInner(state, true)}</div>
    </div>`;
}

/**
 * Live update while the screen is up (score, game change, battlefield pick,
 * champion swap) without replaying the whole entrance. Only tiles / cards that
 * actually changed get a small flip-in.
 */
export function mxUpdate(root, state) {
  const badge = root.querySelector('[data-mx="badge"]');
  if (badge) badge.innerHTML = badgeInner(state);

  [0, 1].forEach((i) => {
    const name = root.querySelector(`[data-mx="name-${i}"]`);
    if (name) name.textContent = playerName(state, i);
    const champEl = root.querySelector(`[data-mx="champ-${i}"] img`);
    const nextChamp = imgOf(championFor(state, PIDS[i], i));
    if (champEl && nextChamp && champEl.getAttribute("src") !== nextChamp) {
      champEl.src = nextChamp;
      flash(champEl.parentElement);
    } else if (!champEl && nextChamp) {
      const hand = root.querySelector(`[data-mx="hand-${i}"]`);
      if (hand) {
        hand.innerHTML = handInner(state, i);
        hand.querySelectorAll(".mp-item").forEach((el) => el.classList.add("mp-settled"));
      }
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
    const key = tileKey(state, t);
    if (el.dataset.key === key) return;
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
