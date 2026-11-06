// OBS tab: connection settings, a scene picker per screen, and live status.
import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

const SCREENS = [
  ["persistent", "In-game", "Normal overlay (scoreboard, panels…)"],
  ["matchup", "Matchup", "Show matchup"],
  ["decklist", "Decklist", "Decklist · P1 / P2"],
];
const $ = (id) => document.getElementById(id);
let status = null;
let editing = false; // don't overwrite fields the user is typing in

async function load() {
  try {
    status = await api("/api/obs");
  } catch {
    return;
  }
  paint();
}

async function save(patch) {
  try {
    status = await api("/api/obs/settings", { method: "POST", body: patch });
    paint();
  } catch (err) {
    $("obs-status").textContent = `Error: ${err.message}`;
  }
}

function stateLine(s) {
  if (!s.settings.enabled) return ["off", "Not connected — tick “Connect to OBS”."];
  if (s.state === "connected") {
    const studio = s.studioMode ? " · Studio Mode on" : "";
    return ["ok", `Connected to OBS (WebSocket ${s.obsVersion})${studio} · live scene: ${s.program || "—"}`];
  }
  if (s.state === "connecting") return ["wait", s.message || "Connecting…"];
  return ["err", `${s.message || "Not connected."} Retrying every few seconds.`];
}

function paint() {
  if (!status) return;
  const s = status;
  const [kind, line] = stateLine(s);
  $("obs-dot").className = `obs-dot ${kind}`;
  const st = $("obs-status");
  st.className = `obs-status ${kind}`;
  st.textContent = line;

  if (!editing) {
    $("obs-enabled").checked = s.settings.enabled;
    $("obs-host").value = s.settings.host;
    $("obs-port").value = s.settings.port;
    $("obs-password").placeholder = s.settings.hasPassword ? "•••••• (saved)" : "No password";
  }
  document.querySelectorAll('input[name="obs-target"]').forEach((r) => (r.checked = r.value === s.settings.target));

  const scenes = s.scenes || [];
  const box = $("obs-scenes");
  const html = SCREENS.map(([key, label, hint]) => {
    const cur = s.settings.scenes[key] || "";
    const opts = [`<option value="">— Don't switch —</option>`]
      .concat(scenes.map((n) => `<option value="${escapeHtml(n)}" ${n === cur ? "selected" : ""}>${escapeHtml(n)}</option>`))
      .concat(cur && !scenes.includes(cur) ? [`<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)} (not found in OBS)</option>`] : [])
      .join("");
    const live = s.program && s.program === cur ? `<span class="obs-live">LIVE</span>` : "";
    return `<div class="obs-scene-row">
      <div><strong>${label}</strong><span class="hint">${hint}</span></div>
      <select data-obs-scene="${key}" ${s.state === "connected" || cur ? "" : "disabled"}>${opts}</select>
      <button class="btn ghost small" data-obs-test="${key}" ${s.state === "connected" && cur ? "" : "disabled"}>Switch now</button>
      ${live}
    </div>`;
  }).join("");
  if (box.dataset.html !== html && !box.contains(document.activeElement)) {
    box.dataset.html = html;
    box.innerHTML = html;
  }

  const last = s.lastSwitch;
  $("obs-last").textContent = last
    ? last.error
      ? `Last switch failed: ${last.scene} — ${last.error}`
      : `Last switch: ${last.scene} (${last.target === "preview" ? "to preview" : "live"}) at ${new Date(last.at).toLocaleTimeString()}`
    : "";
}

$("obs-enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
$("obs-connect").addEventListener("click", async () => {
  const patch = { enabled: true, host: $("obs-host").value.trim() || "127.0.0.1", port: Number($("obs-port").value) || 4455 };
  const pw = $("obs-password").value;
  if (pw) patch.password = pw;
  $("obs-password").value = "";
  editing = false;
  await save(patch);
  if (status?.settings && !patch.password) {
    try {
      status = await api("/api/obs/connect", { method: "POST" });
    } catch {
      /* status poll will show it */
    }
  }
  setTimeout(load, 1500);
});
["obs-host", "obs-port", "obs-password"].forEach((id) => {
  $(id).addEventListener("focus", () => (editing = true));
  $(id).addEventListener("keydown", (e) => e.key === "Enter" && $("obs-connect").click());
});
document.querySelectorAll('input[name="obs-target"]').forEach((r) => r.addEventListener("change", () => save({ target: r.value })));
$("obs-scenes").addEventListener("change", (e) => {
  const sel = e.target.closest("[data-obs-scene]");
  if (sel) save({ scenes: { [sel.dataset.obsScene]: sel.value } });
});
$("obs-scenes").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-obs-test]");
  if (!b) return;
  try {
    status = await api("/api/obs/switch", { method: "POST", body: { screen: b.dataset.obsTest } });
    paint();
  } catch (err) {
    $("obs-last").textContent = `Error: ${err.message}`;
  }
});

load();
setInterval(load, 3000);
