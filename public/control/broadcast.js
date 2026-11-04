// Match tab → "Broadcast" card: round name, match clock, who goes first,
// per-player hand size and level, and records, plus
// which items the overlay shows. Everything also has a Stream Deck hot URL.
import { api } from "./api.js";
import { getData } from "./state.js";
import { ART_LIMITS, artStyle, framingFor } from "/shared/artFraming.js";

const STAT_ROWS = [
  { key: "hand", label: "Hand", show: "hand" },
  { key: "level", label: "Level", show: "level" },
];

const SHOW_LABELS = {
  first: "First / second",
  level: "Level",
  hand: "Hand",
  record: "Records",
  timer: "Clock",
};

let root = null;
let toast = () => {};
let clockTick = null;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function data() {
  return getData();
}
function bc() {
  return data()?.display?.broadcast || { roundLabel: "", timer: { duration: 3000, remaining: 3000, startedAt: null }, show: {} };
}
function game() {
  const d = data();
  return d?.match?.games?.[d.match.currentGame] || {};
}
function stats(pid) {
  return game().stats?.[pid] || { hand: 0, level: 0 };
}
function name(pid) {
  return data()?.players?.find((p) => p.id === pid)?.pseudo || (pid === "p1" ? "Player 1" : "Player 2");
}

function fmt(sec) {
  const neg = sec < 0;
  const s = Math.abs(neg ? Math.floor(sec) : Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${neg ? "+" : ""}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function parseClock(text) {
  const parts = String(text).trim().split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function playerCol(pid) {
  const rec = data()?.players?.find((p) => p.id === pid)?.record || "";
  return `
    <div class="bcx-player" data-player="${pid}">
      <div class="bcx-player-head">
        <strong data-bcx="name-${pid}">${esc(name(pid))}</strong>
        <button type="button" class="btn ghost small" data-bcx-act="first" data-pid="${pid}">Goes first</button>
      </div>
      <label class="bcx-field">Record
        <input type="text" maxlength="24" placeholder="e.g. 11W 0L 2D" data-bcx-record="${pid}" value="${esc(rec)}" />
      </label>
      <div class="bcx-stats">
        ${STAT_ROWS.map(
          (r) => `
          <div class="bcx-stat">
            <span>${r.label}</span>
            <div class="stepper">
              <button type="button" data-bcx-stat="${pid}:${r.key}:-1">−</button>
              <span class="val" data-bcx-val="${pid}:${r.key}">0</span>
              <button type="button" data-bcx-stat="${pid}:${r.key}:1">+</button>
            </div>
          </div>`
        ).join("")}
      </div>
      <details class="bcx-art" data-art-open="${pid}">
        <summary>Art framing</summary>
        <p class="hint">Pick the part of the card art shown in the panel. Saved per card.</p>
        ${artRow(pid, "legend", "Legend")}
        ${artRow(pid, "champion", "Champion")}
      </details>
    </div>`;
}

function artRow(pid, slot, label) {
  const range = (k, name) =>
    `<label class="bcx-art-range"><span>${name}</span><input type="range" data-art="${k}" min="${ART_LIMITS[k].min}" max="${ART_LIMITS[k].max}" step="${ART_LIMITS[k].step}" /></label>`;
  return `
    <div class="bcx-art-row bcx-art-${slot}" data-art-slot="${pid}:${slot}">
      <div class="bcx-art-prev" data-art-prev></div>
      <div class="bcx-art-ctl">
        <div class="bcx-art-head"><strong>${label}</strong> <span class="hint" data-art-name></span></div>
        ${range("zoom", "Zoom")}${range("x", "Left / right")}${range("y", "Up / down")}
        <button type="button" class="btn ghost small" data-art-reset>Reset</button>
      </div>
    </div>`;
}

/** Card id + image for a player's legend or live champion. */
function artCard(pid, slot) {
  const d = data();
  const p = d?.players?.find((x) => x.id === pid);
  const id = slot === "legend" ? p?.deck?.legend : game().champion?.[pid] || p?.deck?.champions?.[0];
  const card = id ? d?.cardsCache?.[id] : null;
  return { id: id || null, card, src: card?.imageLocal || card?.thumbLocal || "" };
}

function framingMap() {
  const d = data();
  d.display ||= {};
  d.display.broadcast ||= bc();
  d.display.broadcast.framing ||= {};
  return d.display.broadcast.framing;
}

function paintArtRow(row, { force = false } = {}) {
  const [pid, slot] = row.dataset.artSlot.split(":");
  const { id, card, src } = artCard(pid, slot);
  row.dataset.card = id || "";
  row.classList.toggle("disabled", !src);
  row.querySelector("[data-art-name]").textContent = card?.name || "— no card —";
  const f = framingFor(id, framingMap());
  const prev = row.querySelector("[data-art-prev]");
  prev.setAttribute("style", src ? artStyle(src, f) : "");
  row.querySelectorAll("[data-art]").forEach((input) => {
    input.disabled = !src;
    if (force || document.activeElement !== input) input.value = f[input.dataset.art];
  });
}

const framingTimers = {};
function sendFraming(cardId, f) {
  clearTimeout(framingTimers[cardId]);
  framingTimers[cardId] = setTimeout(() => post("/api/broadcast/framing", { cardId, ...f }), 120);
}

function build() {
  const b = bc();
  root.innerHTML = `
    <div class="row" style="justify-content: space-between; align-items: center">
      <h2>Broadcast</h2>
      <span class="hint">Shows on the Broadcast layout (Layout tab → Broadcast preset).</span>
    </div>
    <div class="bcx-top">
      <label class="bcx-field bcx-round">Round name
        <input type="text" maxlength="60" placeholder="e.g. Top 4 · Semifinal" data-bcx-round value="${esc(b.roundLabel)}" />
      </label>
      <div class="bcx-clock">
        <span class="inline-lbl">Clock</span>
        <span class="bcx-clock-val" data-bcx="clock">--:--</span>
        <button type="button" class="btn small" data-bcx-act="timer-toggle">Start</button>
        <button type="button" class="btn ghost small" data-bcx-act="timer-reset">Reset</button>
        <button type="button" class="btn ghost small" data-bcx-act="timer-add" data-sec="60">+1 min</button>
        <input type="text" class="bcx-clock-set" placeholder="50:00" data-bcx-clockset />
        <button type="button" class="btn ghost small" data-bcx-act="timer-set">Set</button>
      </div>
    </div>
    <div class="bcx-players">${playerCol("p1")}${playerCol("p2")}</div>
    <details class="bcx-show">
      <summary>Show on overlay</summary>
      <div class="bcx-show-grid">
        ${Object.entries(SHOW_LABELS)
          .map(
            ([k, label]) =>
              `<label><input type="checkbox" data-bcx-show="${k}" ${b.show?.[k] !== false ? "checked" : ""} /> ${label}</label>`
          )
          .join("")}
      </div>
    </details>
    <p class="hint">Stream Deck: <code>/api/hot/stat/p1/hand/inc</code> · <code>/api/hot/stat/p2/level/inc</code> ·
      <code>/api/hot/first/p1</code> · <code>/api/hot/timer/toggle</code></p>`;
  update();
}

/** Refresh values in place (never steals focus from an input being typed in). */
export function update() {
  if (!root || !data()) return;
  const b = bc();
  const g = game();
  for (const pid of ["p1", "p2"]) {
    const st = stats(pid);
    for (const r of STAT_ROWS) {
      const el = root.querySelector(`[data-bcx-val="${pid}:${r.key}"]`);
      if (el) el.textContent = st[r.key] ?? 0;
    }
    const n = root.querySelector(`[data-bcx="name-${pid}"]`);
    if (n) n.textContent = name(pid);
    const firstBtn = root.querySelector(`[data-bcx-act="first"][data-pid="${pid}"]`);
    firstBtn?.classList.toggle("active", g.first === pid);
    const rec = root.querySelector(`[data-bcx-record="${pid}"]`);
    const recVal = data().players.find((p) => p.id === pid)?.record || "";
    if (rec && document.activeElement !== rec) rec.value = recVal;
  }
  const round = root.querySelector("[data-bcx-round]");
  if (round && document.activeElement !== round) round.value = b.roundLabel || "";
  root.querySelectorAll("[data-bcx-show]").forEach((cb) => (cb.checked = b.show?.[cb.dataset.bcxShow] !== false));
  root.querySelectorAll("[data-art-slot]").forEach((row) => paintArtRow(row));
  tick();
}

function tick() {
  const t = bc().timer;
  const el = root?.querySelector('[data-bcx="clock"]');
  if (!el || !t) return;
  const left = t.startedAt ? t.remaining - (Date.now() - t.startedAt) / 1000 : t.remaining;
  el.textContent = fmt(left);
  el.classList.toggle("over", left <= 0);
  const btn = root.querySelector('[data-bcx-act="timer-toggle"]');
  if (btn) btn.textContent = t.startedAt ? "Pause" : "Start";
}

async function post(path, body) {
  try {
    return await api(path, { method: "POST", body });
  } catch (err) {
    toast("Error: " + err.message, "err");
    return null;
  }
}

// Apply the server's answer locally so the panel reacts instantly (the
// WebSocket update follows and agrees).
function applyStats(pid, result) {
  const g = game();
  g.stats ||= {};
  if (result?.result) g.stats[pid] = result.result;
  update();
}

function bind() {
  root.addEventListener("input", (e) => {
    const input = e.target.closest("[data-art]");
    if (!input) return;
    const row = input.closest("[data-art-slot]");
    const cardId = row?.dataset.card;
    if (!cardId) return;
    const f = {};
    row.querySelectorAll("[data-art]").forEach((i) => (f[i.dataset.art] = Number(i.value)));
    framingMap()[cardId] = f;
    const { src } = artCard(...row.dataset.artSlot.split(":"));
    row.querySelector("[data-art-prev]").setAttribute("style", artStyle(src, f));
    sendFraming(cardId, f);
  });

  root.addEventListener("click", async (e) => {
    const resetBtn = e.target.closest("[data-art-reset]");
    if (resetBtn) {
      const row = resetBtn.closest("[data-art-slot]");
      const cardId = row?.dataset.card;
      if (!cardId) return;
      delete framingMap()[cardId];
      paintArtRow(row, { force: true });
      await post("/api/broadcast/framing", { cardId, reset: true });
      return;
    }
    const statBtn = e.target.closest("[data-bcx-stat]");
    if (statBtn) {
      const [pid, key, d] = statBtn.dataset.bcxStat.split(":");
      applyStats(pid, await post("/api/broadcast/stat", { player: pid, key, delta: Number(d) }));
      return;
    }
    const act = e.target.closest("[data-bcx-act]");
    if (!act) return;
    const pid = act.dataset.pid;
    const d = data();
    switch (act.dataset.bcxAct) {
      case "first": {
        const r = await post("/api/broadcast/first", { player: pid });
        if (r) {
          game().first = r.result;
          update();
          toast(r.result ? `${name(r.result)} goes first` : "First player cleared");
        }
        break;
      }
      case "timer-toggle":
      case "timer-reset":
      case "timer-add":
      case "timer-set": {
        const op = act.dataset.bcxAct.slice(6);
        const body = { op };
        if (op === "add") body.seconds = Number(act.dataset.sec) || 60;
        if (op === "set") {
          const s = parseClock(root.querySelector("[data-bcx-clockset]")?.value);
          if (s == null) return toast("Type a time like 50:00", "err");
          body.seconds = s;
        }
        const r = await post("/api/broadcast/timer", body);
        if (r?.result && d?.display?.broadcast) {
          const { now, ...timer } = r.result;
          // Re-base on the local clock to absorb any server/panel skew.
          if (timer.startedAt) timer.startedAt = Date.now() - (now - timer.startedAt);
          d.display.broadcast.timer = timer;
          tick();
        }
        break;
      }
    }
  });

  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-bcx-round]")) {
      const r = await post("/api/broadcast", { roundLabel: t.value });
      if (r) toast("Round name updated");
    } else if (t.matches("[data-bcx-record]")) {
      const pid = t.dataset.bcxRecord;
      const r = await post("/api/broadcast/record", { player: pid, record: t.value });
      if (r) {
        const p = data().players.find((x) => x.id === pid);
        if (p) p.record = r.result;
        toast("Record updated");
      }
    } else if (t.matches("[data-bcx-show]")) {
      const r = await post("/api/broadcast", { show: { [t.dataset.bcxShow]: t.checked } });
      if (r && data()?.display) data().display.broadcast = r.result;
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-bcx-clockset]")) {
      root.querySelector('[data-bcx-act="timer-set"]')?.click();
    }
  });
}

export function initBroadcast({ toast: toastFn } = {}) {
  root = document.getElementById("broadcast-block");
  if (!root) return;
  if (toastFn) toast = toastFn;
  bind();
  if (!clockTick) clockTick = setInterval(tick, 250);
}

/** Full (re)render, e.g. after a data reload or player rename. */
export function renderBroadcast() {
  if (!root || !data()) return;
  if (data().activeGame === "pokemon") {
    root.classList.add("hidden");
    return;
  }
  root.classList.remove("hidden");
  build();
}
