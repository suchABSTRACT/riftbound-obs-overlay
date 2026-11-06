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

// ---- Battlefields (matchup screen) -------------------------------------------------
//
// Battlefield images are often stored sideways (a portrait file holding the
// landscape card). Each one is shown upright, zoomed and centred on its art:
// `rot` is "auto" (turn portrait files upright) or 0 / 90 / -90 degrees;
// `x` / `y` are the point of the upright card kept in view; `zoom` crops in.
// Rendered as an <img> inside a box with `container-type: size`.

export const BF_DEFAULT = { x: 50, y: 30, zoom: 1.35, rot: "auto" };
export const BF_ROTATIONS = ["auto", 0, 90, -90];
/** Which way "auto" turns a portrait file (degrees, clockwise). */
export const BF_AUTO_ROT = 90;

export function bfFramingFor(cardId, framingMap) {
  const f = (cardId && framingMap?.[cardId]) || {};
  return {
    x: Number.isFinite(f.x) ? f.x : BF_DEFAULT.x,
    y: Number.isFinite(f.y) ? f.y : BF_DEFAULT.y,
    zoom: Number.isFinite(f.zoom) ? f.zoom : BF_DEFAULT.zoom,
    rot: [0, 90, -90].includes(f.rot) ? f.rot : "auto",
  };
}

/** <img> for a battlefield; call fitBfImg() on it (done on load automatically). */
export function bfImgHtml(src, f) {
  const url = String(src).replace(/["'\\\n<>]/g, "");
  return `<img class="bf-img" src="${url}" alt="" data-bf="${f.x},${f.y},${f.zoom},${f.rot}" style="opacity:0" />`;
}

/** Size / rotate / crop a battlefield <img> once its natural size is known. */
export function fitBfImg(img) {
  if (!img?.naturalWidth) return;
  const [x, y, zoom, rotRaw] = (img.dataset.bf || "").split(",");
  const portrait = img.naturalHeight > img.naturalWidth;
  const rot = rotRaw === "auto" ? (portrait ? BF_AUTO_ROT : 0) : Number(rotRaw) || 0;
  const u = Number(x), v = Number(y), z = Number(zoom) || 1;
  // Focus point in the image's own (unrotated) coordinates.
  const [ix, iy] = rot === 90 ? [v, 100 - u] : rot === -90 ? [100 - v, u] : [u, v];
  const sideways = rot !== 0;
  // The (upright) picture is z× the box; place it so the focus point of the
  // card sits at the same spot of the box (like background-position).
  const cx = `calc(100cqw * ${(z / 2 - ((z - 1) * u) / 100).toFixed(4)})`;
  const cy = `calc(100cqh * ${(z / 2 - ((z - 1) * v) / 100).toFixed(4)})`;
  img.style.cssText =
    `position:absolute;left:${cx};top:${cy};max-width:none;object-fit:cover;` +
    `width:calc(${sideways ? "100cqh" : "100cqw"} * ${z});height:calc(${sideways ? "100cqw" : "100cqh"} * ${z});` +
    `object-position:${ix}% ${iy}%;` +
    `transform:translate(-50%,-50%) rotate(${rot}deg);`;
}

/** Wire up every battlefield <img> under `root` (current and future). */
export function watchBfImgs(root) {
  if (!root || root.__bfWatch) return;
  root.__bfWatch = true;
  // "load" doesn't bubble, but it can be caught on the way down.
  root.addEventListener(
    "load",
    (e) => {
      if (e.target?.matches?.("img.bf-img")) fitBfImg(e.target);
    },
    true
  );
}

/** Fit battlefield images that were already loaded (e.g. from cache). */
export function fitAllBfImgs(root) {
  root?.querySelectorAll("img.bf-img").forEach((img) => img.complete && fitBfImg(img));
}
