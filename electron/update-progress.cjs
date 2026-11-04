/**
 * "Updating Riftbound OBS" window.
 *
 * Launched as `Riftbound OBS.exe --update-progress --version=X --port=N` just
 * before the app closes to apply an update. It runs no server and takes no
 * single-instance lock, reads the updater's apply-status.json, and shows each
 * step, a progress bar and elapsed time. It closes itself once the updated
 * app answers on its port, or offers the log if something goes wrong.
 */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const PHASES = {
  validated: { pct: 4, step: 0 },
  shutting_down: { pct: 10, step: 0 },
  spawned: { pct: 22, step: 0 },
  waiting_app_exit: { pct: 32, step: 0 },
  extracting: { pct: 50, step: 1 },
  applying: { pct: 68, step: 2 },
  rebuilding: { pct: 78, step: 2 },
  running_installer: { pct: 60, step: 2 },
  restarting: { pct: 90, step: 3 },
  success: { pct: 96, step: 3 },
};

function arg(name, fallback = "") {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function updatesDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "RiftboundOBS", "updates");
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(path.join(updatesDir(), "apply-status.json"), "utf8"));
  } catch {
    return null;
  }
}

function appVersion(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/version", timeout: 800 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).version || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function run() {
  const version = arg("version");
  const port = Number(arg("port", "7474")) || 7474;
  const startedAt = Date.now();

  // Separate profile so this window never contends with the main app's.
  app.setPath("userData", path.join(os.tmpdir(), "riftbound-update-progress"));
  app.disableHardwareAcceleration();

  app.whenReady().then(() => {
    const win = new BrowserWindow({
      width: 460,
      height: 205,
      resizable: false,
      maximizable: false,
      minimizable: true,
      alwaysOnTop: true,
      title: "Updating Riftbound OBS",
      backgroundColor: "#0b1230",
      autoHideMenuBar: true,
      icon: path.join(__dirname, "icon.png"),
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    win.removeMenu();
    win.loadFile(path.join(__dirname, "update-progress.html"), { query: { v: version } });

    // Buttons in the page navigate to rb-action:… — handled here.
    win.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith("rb-action:")) return;
      e.preventDefault();
      if (url === "rb-action:log") shell.openPath(updatesDir());
      if (url === "rb-action:close") app.quit();
    });

    let done = false;
    let lastPhase = null;
    let lastChange = Date.now();

    const push = (view) => {
      if (win.isDestroyed()) return;
      win.webContents.executeJavaScript(`window.render && window.render(${JSON.stringify(view)})`).catch(() => {});
    };

    const tick = async () => {
      if (done || win.isDestroyed()) return;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const s = readStatus();
      // Ignore a status file left over from an earlier update.
      const fresh = s && (!s.at || Date.parse(s.at) >= startedAt - 15000) && (!version || !s.version || s.version === version);
      const phase = fresh ? s.phase : "shutting_down";
      if (phase !== lastPhase) {
        lastPhase = phase;
        lastChange = Date.now();
      }

      if (phase === "failed") {
        done = true;
        push({ state: "failed", elapsed, message: s.error || s.message || "The update failed." });
        return;
      }

      if (phase === "restarting" || phase === "success") {
        const running = await appVersion(port);
        if (running && (!version || running === version)) {
          done = true;
          push({ state: "done", step: 4, pct: 100, elapsed, message: `Updated to v${running}.` });
          setTimeout(() => app.quit(), 1600);
          return;
        }
      }

      const p = PHASES[phase] || PHASES.shutting_down;
      const slow = Date.now() - lastChange > 90000;
      push({
        state: slow ? "slow" : "working",
        step: p.step,
        pct: p.pct,
        elapsed,
        message: fresh ? s.message || "" : "Closing Riftbound OBS…",
      });
    };

    win.webContents.on("did-finish-load", () => {
      tick();
      const timer = setInterval(() => {
        if (done || win.isDestroyed()) return clearInterval(timer);
        tick();
      }, 500);
    });

    // Safety net: never linger forever.
    setTimeout(() => app.quit(), 10 * 60 * 1000);
  });

  app.on("window-all-closed", () => app.quit());
}

module.exports = { run };
