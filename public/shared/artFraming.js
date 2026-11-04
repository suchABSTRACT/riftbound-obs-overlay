// How a card's artwork is framed inside the broadcast player panel.
//
// Riftbound card images include the frame, cost gem, name bar and rules text;
// only the upper part is the painting. Each art box shows the card zoomed in
// and focused on a point: `zoom` (1 = card width fills the box), and `x` / `y`
// (0–100, the point of the card kept in view — like CSS background-position).
// Per-card overrides come from the control panel's "Art framing" editor.

export const ART_DEFAULT = { x: 50, y: 24, zoom: 1.2 };

export const ART_LIMITS = {
  zoom: { min: 1, max: 4, step: 0.05 },
  x: { min: 0, max: 100, step: 1 },
  y: { min: 0, max: 100, step: 1 },
};

export function framingFor(cardId, framingMap) {
  const f = (cardId && framingMap?.[cardId]) || {};
  return {
    x: Number.isFinite(f.x) ? f.x : ART_DEFAULT.x,
    y: Number.isFinite(f.y) ? f.y : ART_DEFAULT.y,
    zoom: Number.isFinite(f.zoom) ? f.zoom : ART_DEFAULT.zoom,
  };
}

/** Inline style for a <div> showing `src` framed by `f` (from framingFor). */
export function artStyle(src, f) {
  const url = String(src).replace(/["'\\\n]/g, "");
  return (
    `background-image:url("${url}");background-repeat:no-repeat;` +
    `background-size:${(f.zoom * 100).toFixed(1)}% auto;` +
    `background-position:${f.x}% ${f.y}%`
  );
}
