/**
 * Pure map gesture maths — no DOM, no React, no data import, so every rule the
 * atlas map obeys can be asserted directly (see map-gestures.test.ts).
 * `AtlasClient` owns the Pointer Event plumbing; all the arithmetic lives here.
 *
 * Two coordinate spaces are in play:
 *  - **client px** — what `PointerEvent.clientX/clientY` report.
 *  - **stage units** — the map SVG's own viewBox units. `toStagePoint` converts
 *    client px to stage units, undoing `preserveAspectRatio="xMidYMid meet"`.
 *
 * The view itself is `translate(x y) scale(k)` on the world group, so a point
 * of the *content* maps to the stage as `content * k + (x, y)` — that is
 * `project`, and `unproject` is its inverse.
 */

export type Point = { readonly x: number; readonly y: number };
export type View = { readonly x: number; readonly y: number; readonly k: number };
/** The map's own coordinate box — the SVG viewBox size. */
export type Extent = { readonly width: number; readonly height: number };
/** The subset of DOMRect the conversion needs. */
export type Rect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
/** A pointerup reduced to what double-tap detection needs. */
export type Tap = { readonly x: number; readonly y: number; readonly time: number };

/** Zoom limits — the single source of truth, imported by AtlasClient. */
export const MIN_ZOOM = 1;
/**
 * 24 reached roughly 340 m per screen pixel over south India — regional, not
 * the district-and-town view the atlas is for. Ten times that lands near 34 m
 * per pixel, which separates neighbouring temples in a single town.
 */
export const MAX_ZOOM = 240;

/** Double tap: two taps inside this window and this radius (client px). */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;
/** How far a double tap zooms in. */
export const DOUBLE_TAP_ZOOM = 1.8;
/** How far a pointer may drift (client px) and still count as a tap, not a drag. */
export const TAP_SLOP_PX = 8;

/** Discrete wheel notches, as the atlas has always used them. */
export const WHEEL_ZOOM_IN = 1.25;
export const WHEEL_ZOOM_OUT = 0.8;
/** Trackpad pinch arrives as a ctrlKey wheel with a small continuous deltaY. */
export const TRACKPAD_PINCH_SENSITIVITY = 0.01;
const MIN_WHEEL_STEP = 0.5;
const MAX_WHEEL_STEP = 2;

/* ------------------------------------------------------------ mark sizing */

/**
 * Site marks are sized in *content* units, then drawn inside a group scaled by
 * `k` — so a radius that is constant in content units grows on screen as you
 * zoom. Dividing by `k` is what holds a mark still, and `cluster.ts` sizes its
 * cells assuming exactly that (see `CLUSTER_CELL_STAGE`).
 *
 * This used to read `Math.max(4.6 / k, 1.6)`. The floor was applied in content
 * units, so past k≈2.9 the mark stopped shrinking and its screen radius grew as
 * 1.6·k — about 52 px at full zoom, some 17 km across the ground. Zooming into
 * a dense district made the crowding worse, which is the opposite of what
 * zooming is for.
 */
export const SITE_MARK_STAGE_R = 4.6;

/**
 * Once nothing clusters any more, the marks taper: past that point the map is
 * being used to tell neighbours apart, and a smaller mark separates two temples
 * a few hundred metres apart that a larger one would merge.
 */
export const SITE_MARK_STAGE_R_CLOSE = 2.4;

/** Where the taper begins — kept equal to `cluster.ts`'s `NO_CLUSTER_ZOOM`. */
export const MARK_TAPER_FROM_ZOOM = 10;

/** Screen-space mark radius at a given zoom, in stage units. */
export const siteMarkStageRadius = (k: number): number => {
  if (k <= MARK_TAPER_FROM_ZOOM) return SITE_MARK_STAGE_R;
  const span = Math.log2(MAX_ZOOM / MARK_TAPER_FROM_ZOOM);
  const t = span <= 0 ? 1 : clamp(Math.log2(k / MARK_TAPER_FROM_ZOOM) / span, 0, 1);
  return SITE_MARK_STAGE_R + (SITE_MARK_STAGE_R_CLOSE - SITE_MARK_STAGE_R) * t;
};

/** Mark radius in content units — what the SVG `r` attribute takes. */
export const siteMarkRadius = (k: number): number =>
  siteMarkStageRadius(k) / Math.max(k, 1e-6);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clampZoom = (k: number): number => clamp(k, MIN_ZOOM, MAX_ZOOM);

export const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Content units -> stage units under a view. */
export const project = (view: View, content: Point): Point => ({
  x: content.x * view.k + view.x,
  y: content.y * view.k + view.y,
});

/** Stage units -> content units under a view. */
export const unproject = (view: View, stage: Point): Point => ({
  x: (stage.x - view.x) / view.k,
  y: (stage.y - view.y) / view.k,
});

/**
 * Scale about a stage point, keeping whatever content sits under that point
 * exactly where it is — the invariant every anchored zoom depends on:
 * `project(scaleAbout(v, a, f), unproject(v, a))` equals `a`. Holds even when
 * the factor is refused by the zoom clamp, because the new translation is
 * derived from the *clamped* scale.
 */
export const scaleAbout = (view: View, anchor: Point, factor: number): View => {
  const k = clampZoom(view.k * factor);
  const content = unproject(view, anchor);
  return { k, x: anchor.x - content.x * k, y: anchor.y - content.y * k };
};

export const translateBy = (view: View, dx: number, dy: number): View => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
});

/**
 * Keep the content covering the stage: the map may never be dragged or pinched
 * off its own bounds. At k = 1 the only legal translation is the origin, which
 * is exactly the snap-back the atlas has always done at minimum zoom.
 */
export const clampTranslate = (view: View, extent: Extent): View => ({
  ...view,
  x: clamp(view.x, extent.width * (1 - view.k), 0),
  y: clamp(view.y, extent.height * (1 - view.k), 0),
});

/** Stage units per client px for `preserveAspectRatio="xMidYMid meet"`. */
export const viewportScale = (extent: Extent, viewport: Rect): number => {
  if (!(viewport.width > 0) || !(viewport.height > 0)) return 1;
  return Math.max(extent.width / viewport.width, extent.height / viewport.height);
};

/** A client-space point (a pointer, a cursor, a pinch midpoint) in stage units. */
export const toStagePoint = (client: Point, viewport: Rect, extent: Extent): Point => {
  const scale = viewportScale(extent, viewport);
  const offsetX = (viewport.width - extent.width / scale) / 2;
  const offsetY = (viewport.height - extent.height / scale) / 2;
  return {
    x: (client.x - viewport.left - offsetX) * scale,
    y: (client.y - viewport.top - offsetY) * scale,
  };
};

/** Ratio of the current finger spread to the previous one; 1 when unusable. */
export const pinchFactor = (previous: number, current: number): number =>
  previous > 0 && current > 0 ? current / previous : 1;

/**
 * A trackpad pinch reaches the page as a `wheel` event with `ctrlKey` set, and
 * wants a continuous factor; a real wheel wants the discrete notch.
 */
export const wheelZoomFactor = (deltaY: number, isTrackpadPinch: boolean): number => {
  if (!isTrackpadPinch) return deltaY < 0 ? WHEEL_ZOOM_IN : WHEEL_ZOOM_OUT;
  const factor = Math.exp(-deltaY * TRACKPAD_PINCH_SENSITIVITY);
  return clamp(factor, MIN_WHEEL_STEP, MAX_WHEEL_STEP);
};

/** Two taps close enough in time *and* space to mean "zoom in here". */
export const isDoubleTap = (
  previous: Tap | null,
  current: Tap,
  maxMs: number = DOUBLE_TAP_MS,
  maxPx: number = DOUBLE_TAP_PX,
): boolean => {
  if (!previous) return false;
  const elapsed = current.time - previous.time;
  if (elapsed < 0 || elapsed > maxMs) return false;
  return distance(previous, current) <= maxPx;
};
