// In-page confirm dialog.
//
// The browser's built-in confirm() has a long-standing Electron bug on
// Windows: after it closes, text fields stop accepting typing until the window
// loses and regains focus. This draws the dialog inside the page instead.

let dialogEl = null;

function ensureDialog() {
  if (dialogEl) return dialogEl;
  dialogEl = document.createElement("dialog");
  dialogEl.className = "app-dialog";
  dialogEl.innerHTML = `
    <form method="dialog">
      <h3 class="app-dialog-title"></h3>
      <p class="app-dialog-msg"></p>
      <div class="app-dialog-actions">
        <button type="submit" value="cancel" class="btn ghost" data-dlg-cancel>Cancel</button>
        <button type="submit" value="ok" class="btn" data-dlg-ok>OK</button>
      </div>
    </form>`;
  document.body.appendChild(dialogEl);
  return dialogEl;
}

/**
 * Ask the user to confirm. Resolves true for OK, false for Cancel / Esc.
 * Focus goes back to whatever had it before, so typing keeps working.
 */
export function confirmDialog(message, { title = "Are you sure?", ok = "OK", cancel = "Cancel", danger = false } = {}) {
  const dlg = ensureDialog();
  const previous = document.activeElement;
  dlg.querySelector(".app-dialog-title").textContent = title;
  dlg.querySelector(".app-dialog-msg").textContent = message;
  const okBtn = dlg.querySelector("[data-dlg-ok]");
  okBtn.textContent = ok;
  okBtn.classList.toggle("danger", danger);
  dlg.querySelector("[data-dlg-cancel]").textContent = cancel;
  dlg.returnValue = "";

  return new Promise((resolve) => {
    dlg.addEventListener(
      "close",
      () => {
        resolve(dlg.returnValue === "ok");
        if (previous && typeof previous.focus === "function" && document.contains(previous)) {
          previous.focus();
        }
      },
      { once: true }
    );
    dlg.showModal();
    okBtn.focus();
  });
}
