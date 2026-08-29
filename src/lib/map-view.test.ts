import test from "node:test";
import assert from "node:assert/strict";

import { initialView } from "./map-view.ts";
import { MAP_BOX } from "./generated/map-projection.ts";
import { INDIA_BOUNDS, boundsToRect } from "./layers.ts";
import { MIN_ZOOM, MAX_ZOOM, project } from "./map-gestures.ts";

const EXTENT = { width: MAP_BOX.W, height: MAP_BOX.H };

test("a wide screen still opens on the whole Indic world", () => {
  // Arrange / Act
  const v = initialView(EXTENT, false);
  // Assert: unchanged behaviour — the atlas is about the whole region.
  assert.deepEqual(v, { x: 0, y: 0, k: MIN_ZOOM });
});

test("a phone opens zoomed in, not on an ocean", () => {
  const v = initialView(EXTENT, true);
  assert.ok(v.k > MIN_ZOOM, `expected a closer view, got k=${v.k}`);
  assert.ok(v.k <= MAX_ZOOM);
});

test("the subcontinent is centred on a phone", () => {
  const v = initialView(EXTENT, true);
  const r = boundsToRect(MAP_BOX, INDIA_BOUNDS);
  const centre = project(v, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
  // Within a pixel of the middle of the stage.
  assert.ok(Math.abs(centre.x - EXTENT.width / 2) < 1, `x off by ${centre.x - EXTENT.width / 2}`);
  assert.ok(Math.abs(centre.y - EXTENT.height / 2) < 1, `y off by ${centre.y - EXTENT.height / 2}`);
});

test("the whole of India still fits — zooming in must not crop Kashmir or Kanyakumari", () => {
  const v = initialView(EXTENT, true);
  const r = boundsToRect(MAP_BOX, INDIA_BOUNDS);
  const topLeft = project(v, { x: r.x, y: r.y });
  const bottomRight = project(v, { x: r.x + r.width, y: r.y + r.height });
  assert.ok(topLeft.x >= 0 && topLeft.y >= 0, `top-left clipped at ${topLeft.x},${topLeft.y}`);
  assert.ok(bottomRight.x <= EXTENT.width && bottomRight.y <= EXTENT.height,
    `bottom-right clipped at ${bottomRight.x},${bottomRight.y}`);
});

test("the framing does not depend on the stage being square", () => {
  // Extent is the viewBox, not the device, so this is a guard against someone
  // later passing device pixels and getting a silently different framing.
  const tall = initialView({ width: MAP_BOX.W, height: MAP_BOX.H * 2 }, true);
  assert.ok(tall.k > MIN_ZOOM);
  assert.ok(Number.isFinite(tall.x) && Number.isFinite(tall.y));
});
