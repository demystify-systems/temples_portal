import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_ZOOM, MAX_ZOOM, DOUBLE_TAP_MS, DOUBLE_TAP_PX,
  clamp, clampZoom, clampTranslate, distance,
  midpoint, project, unproject, scaleAbout,
  translateBy, viewportScale, toStagePoint, pinchFactor,
  wheelZoomFactor, isDoubleTap, type View, MARK_TAPER_FROM_ZOOM,
  SITE_MARK_STAGE_R, SITE_MARK_STAGE_R_CLOSE, siteMarkRadius,
} from "./map-gestures.ts";

const EXTENT = { width: 1000, height: 700 };
const near = (actual: number, expected: number, msg?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ""} expected ${expected}, got ${actual}`);

test("distance between two pointers is the euclidean 3-4-5", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distance({ x: -3, y: -4 }, { x: 0, y: 0 }), 5, "sign of the span does not matter");
});

test("distance is symmetric and zero for a pinch that has not opened", () => {
  const a = { x: 120.5, y: -8 }, b = { x: 44, y: 301.25 };
  assert.equal(distance(a, b), distance(b, a));
  assert.equal(distance(a, a), 0);
});

test("midpoint is the point the pinch zooms toward", () => {
  assert.deepEqual(midpoint({ x: 0, y: 0 }, { x: 10, y: 20 }), { x: 5, y: 10 });
  assert.deepEqual(midpoint({ x: -6, y: 3 }, { x: 6, y: 7 }), { x: 0, y: 5 });
});

test("project and unproject are inverses", () => {
  const view: View = { x: -320, y: 118.5, k: 3.25 };
  const stage = { x: 412, y: 260 };
  const round = project(view, unproject(view, stage));
  near(round.x, stage.x, "x");
  near(round.y, stage.y, "y");
});

test("scaling about a point leaves that point stationary (the anchor invariant)", () => {
  // Whatever content sits under the anchor must still sit under it afterwards —
  // this is the whole of "pinch zooms toward the fingers, not toward the centre".
  const views: View[] = [{ x: 0, y: 0, k: 1 }, { x: -640, y: -210, k: 4 }, { x: 77.5, y: -18.25, k: 2.5 }];
  const anchors = [{ x: 0, y: 0 }, { x: 500, y: 350 }, { x: 913.75, y: 42.5 }];
  for (const view of views) {
    for (const anchor of anchors) {
      for (const factor of [1.05, 1.8, 0.6, 1 / 3]) {
        const content = unproject(view, anchor);
        const after = project(scaleAbout(view, anchor, factor), content);
        near(after.x, anchor.x, `x @k=${view.k} f=${factor}`);
        near(after.y, anchor.y, `y @k=${view.k} f=${factor}`);
      }
    }
  }
});

test("the anchor stays stationary even when the zoom clamp refuses the factor", () => {
  // A pinch at full zoom must not lurch: the translation is derived from the
  // clamped scale, so a refused factor is a no-op, not a jump.
  const view: View = { x: -1200, y: -400, k: MAX_ZOOM };
  const anchor = { x: 640, y: 210 };
  const after = scaleAbout(view, anchor, 4);
  assert.equal(after.k, MAX_ZOOM);
  const moved = project(after, unproject(view, anchor));
  near(moved.x, anchor.x, "x");
  near(moved.y, anchor.y, "y");
});

test("scaleAbout multiplies the existing scale", () => {
  assert.equal(scaleAbout({ x: 0, y: 0, k: 2 }, { x: 100, y: 100 }, 1.5).k, 3);
});

test("clamp and clampZoom hold both ends", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(clampZoom(0.2), MIN_ZOOM, "cannot zoom out past the whole map");
  assert.equal(clampZoom(1000), MAX_ZOOM, "cannot zoom in past the ceiling");
  assert.equal(clampZoom(7.5), 7.5, "an in-range scale passes through");
});

test("zoom clamps at both ends however many gestures are chained", () => {
  let view: View = { x: 0, y: 0, k: 1 };
  for (let i = 0; i < 40; i++) view = scaleAbout(view, { x: 500, y: 350 }, 1.5);
  assert.equal(view.k, MAX_ZOOM);
  for (let i = 0; i < 60; i++) view = scaleAbout(view, { x: 500, y: 350 }, 0.7);
  assert.equal(view.k, MIN_ZOOM);
});

test("clampTranslate pins the view to the origin at minimum zoom", () => {
  const pushed = clampTranslate({ x: 400, y: -250, k: MIN_ZOOM }, EXTENT);
  assert.deepEqual(pushed, { x: 0, y: 0, k: MIN_ZOOM });
});

test("clampTranslate never lets the map escape its bounds", () => {
  const k = 4;
  assert.equal(clampTranslate({ x: 900, y: 0, k }, EXTENT).x, 0, "cannot drag past the left edge");
  assert.equal(clampTranslate({ x: -9000, y: 0, k }, EXTENT).x, EXTENT.width * (1 - k), "nor past the right");
  assert.equal(clampTranslate({ x: 0, y: 500, k }, EXTENT).y, 0, "nor past the top");
  assert.equal(clampTranslate({ x: 0, y: -9000, k }, EXTENT).y, EXTENT.height * (1 - k), "nor past the bottom");
  const inside = { x: -1200, y: -800, k };
  assert.deepEqual(clampTranslate(inside, EXTENT), inside, "a legal view is untouched");
});

test("translateBy moves the view without touching the scale", () => {
  assert.deepEqual(translateBy({ x: 10, y: 20, k: 3 }, -4, 6), { x: 6, y: 26, k: 3 });
});

test("viewportScale undoes xMidYMid meet letterboxing", () => {
  assert.equal(viewportScale(EXTENT, { left: 0, top: 0, width: 500, height: 350 }), 2, "exact aspect fit");
  assert.equal(viewportScale(EXTENT, { left: 0, top: 0, width: 2000, height: 350 }), 2, "height binds when wide");
  assert.equal(viewportScale(EXTENT, { left: 0, top: 0, width: 500, height: 7000 }), 2, "width binds when tall");
  assert.equal(viewportScale(EXTENT, { left: 0, top: 0, width: 0, height: 0 }), 1, "a zero-size map never yields Infinity");
});

test("toStagePoint maps the viewport centre to the extent centre", () => {
  const viewport = { left: 40, top: 12, width: 2000, height: 350 }; // wider than the extent: letterboxed
  const centre = toStagePoint({ x: 40 + 1000, y: 12 + 175 }, viewport, EXTENT);
  near(centre.x, EXTENT.width / 2, "x");
  near(centre.y, EXTENT.height / 2, "y");
});

test("toStagePoint accounts for the element offset on the page", () => {
  const viewport = { left: 100, top: 50, width: 500, height: 350 }; // exact fit, scale 2
  assert.deepEqual(toStagePoint({ x: 100, y: 50 }, viewport, EXTENT), { x: 0, y: 0 });
  assert.deepEqual(toStagePoint({ x: 350, y: 225 }, viewport, EXTENT), { x: 500, y: 350 });
});

test("pinchFactor is the ratio of finger spreads, guarded against zero", () => {
  assert.equal(pinchFactor(100, 150), 1.5);
  assert.equal(pinchFactor(150, 100), 100 / 150);
  assert.equal(pinchFactor(0, 120), 1, "a first move with no baseline must not zoom");
  assert.equal(pinchFactor(120, 0), 1, "two fingers landing on one spot must not divide by zero");
});

test("wheelZoomFactor keeps the discrete notch for a real wheel", () => {
  assert.ok(wheelZoomFactor(-120, false) > 1, "wheel up zooms in");
  assert.ok(wheelZoomFactor(120, false) < 1, "wheel down zooms out");
});

test("wheelZoomFactor treats a ctrlKey wheel as a continuous trackpad pinch", () => {
  assert.ok(wheelZoomFactor(-4, true) > 1, "pinch open zooms in");
  assert.ok(wheelZoomFactor(4, true) < 1, "pinch closed zooms out");
  assert.ok(wheelZoomFactor(-4, true) < wheelZoomFactor(-120, false), "a small pinch is gentler than a notch");
  near(wheelZoomFactor(0, true), 1, "a null delta is a no-op");
  assert.ok(wheelZoomFactor(-100000, true) <= 2, "a runaway delta cannot teleport the map");
  assert.ok(wheelZoomFactor(100000, true) >= 0.5, "and neither can its opposite");
});

test("isDoubleTap accepts two taps inside the time and distance thresholds", () => {
  const first = { x: 200, y: 300, time: 1000 };
  assert.equal(isDoubleTap(first, { x: 205, y: 308, time: 1180 }), true);
});

test("a second tap outside the time threshold is NOT a double tap", () => {
  const first = { x: 200, y: 300, time: 1000 };
  assert.equal(isDoubleTap(first, { x: 200, y: 300, time: 1000 + DOUBLE_TAP_MS + 1 }), false);
  assert.equal(isDoubleTap(first, { x: 200, y: 300, time: 1000 + DOUBLE_TAP_MS }), true, "the boundary is inclusive");
});

test("a second tap outside the distance threshold is NOT a double tap", () => {
  const first = { x: 200, y: 300, time: 1000 };
  const far = { x: 200 + DOUBLE_TAP_PX + 1, y: 300, time: 1050 };
  assert.equal(isDoubleTap(first, far), false, "two deliberate taps in different places stay two taps");
  assert.equal(isDoubleTap(first, { x: 200 + DOUBLE_TAP_PX, y: 300, time: 1050 }), true, "the boundary is inclusive");
});

test("isDoubleTap needs a previous tap and rejects a backwards clock", () => {
  assert.equal(isDoubleTap(null, { x: 0, y: 0, time: 1000 }), false, "the very first tap is never a double");
  assert.equal(isDoubleTap({ x: 0, y: 0, time: 1000 }, { x: 0, y: 0, time: 900 }), false);
});

// ---- mark sizing: the regression that made dots swallow districts ----------

test("a mark keeps a constant screen size while clustering is active", () => {
  // Arrange: cluster.ts sizes its cells assuming exactly this.
  for (const k of [1, 2, 4, 8, MARK_TAPER_FROM_ZOOM]) {
    // Act
    const onScreen = siteMarkRadius(k) * k;
    // Assert
    assert.ok(Math.abs(onScreen - SITE_MARK_STAGE_R) < 1e-9, `k=${k} gave ${onScreen}`);
  }
});

test("a mark never grows on screen as the map zooms in", () => {
  // The old `Math.max(4.6 / k, 1.6)` floored the radius in *content* units, so
  // past k≈2.9 the screen radius grew as 1.6·k — a 52px blob at full zoom.
  let previous = Infinity;
  for (let k = 1; k <= MAX_ZOOM; k *= 1.2) {
    const onScreen = siteMarkRadius(k) * k;
    assert.ok(onScreen <= previous + 1e-9, `screen radius grew at k=${k}`);
    previous = onScreen;
  }
});

test("marks are smaller at full zoom than at the world view, so dense towns resolve", () => {
  const far = siteMarkRadius(MIN_ZOOM) * MIN_ZOOM;
  const close = siteMarkRadius(MAX_ZOOM) * MAX_ZOOM;
  assert.ok(close < far, `close ${close} should be under far ${far}`);
  assert.ok(Math.abs(close - SITE_MARK_STAGE_R_CLOSE) < 1e-9);
});

test("the radius stays positive and finite across the whole zoom range", () => {
  for (const k of [MIN_ZOOM, 1.5, 10, 100, MAX_ZOOM]) {
    const r = siteMarkRadius(k);
    assert.ok(Number.isFinite(r) && r > 0, `k=${k} gave ${r}`);
  }
});

test("full zoom resolves two temples a few hundred metres apart", () => {
  // Thanjavur district: the screenshot's problem case. One content unit is
  // (LON1-LON0)/W = 74/1480 = 0.05° of longitude ≈ 5.46 km at 11°N.
  const KM_PER_CONTENT_UNIT = 0.05 * 111.32 * Math.cos((11 * Math.PI) / 180);
  const markKm = siteMarkRadius(MAX_ZOOM) * KM_PER_CONTENT_UNIT;
  // Two marks separate once their centres are more than a diameter apart.
  assert.ok(markKm * 2 < 0.5, `mark spans ${(markKm * 2).toFixed(3)} km on the ground`);
});
