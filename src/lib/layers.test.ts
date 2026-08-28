import test from "node:test";
import assert from "node:assert/strict";
import {
  INDIA_BOUNDS, MAP_LAYERS, MAX_REQUEST_PX, MIN_REQUEST_PX, REQUEST_PADDING,
  activeAttributions, activeTermsNotes, boundsToRect, builtinOffClasses, contentLat, contentLon,
  contentPerCssPx, contentX, contentY, defaultLayerState, intersectRect, isBuiltin, isWms,
  layerById, mercLat, mercY, padRect, placedPoint, rectToMetreBox, snapRect, visibleContentRect,
  webMercatorX, webMercatorY, wmsRequest,
  type ContentRect, type MapFrame, type MapLayer, type ViewTransform,
} from "./layers.ts";

/**
 * The atlas frame, transcribed from `data/geo.json`. Held as a literal rather
 * than imported because `src/lib/sites.ts` pulls in the whole 1,100-record
 * corpus through a bare JSON import, which `node --test` cannot resolve.
 * `frame matches data/geo.json` below is what keeps the transcription honest.
 */
const FRAME: MapFrame = { W: 1480, H: 1136.5, LON0: 58, LON1: 132, LAT0: -13, LAT1: 40 };

/**
 * THE REFERENCE PROJECTION — a verbatim transcription of AtlasClient.tsx's own
 * `mercY` / `PX` / `PY` (lines 25-28). Everything in layers.ts is measured
 * against these four lines: the overlay is only in the right place if it agrees
 * with where the map already puts its 1,100 marks.
 */
const refMercY = (t: number) => Math.log(Math.tan(Math.PI / 4 + (t * Math.PI) / 180 / 2));
const YT = refMercY(FRAME.LAT1), YB = refMercY(FRAME.LAT0);
const PX = (lon: number) => ((lon - FRAME.LON0) / (FRAME.LON1 - FRAME.LON0)) * FRAME.W;
const PY = (lat: number) => ((YT - refMercY(lat)) / (YT - YB)) * FRAME.H;

/** Real sites from the corpus, spread across the frame's whole latitude range. */
const LANDMARKS: readonly (readonly [string, number, number])[] = [
  ["Kedarnath", 30.7346, 79.0669],
  ["Kashi Vishwanath", 25.3109, 83.0107],
  ["Somnath", 20.888, 70.4013],
  ["Meenakshi, Madurai", 9.9195, 78.1193],
  ["Kanyakumari", 8.0779, 77.5405],
  ["Vaishno Devi (J&K)", 33.0301, 74.9497],
  ["Tawang (Arunachal)", 27.5861, 91.8594],
  ["Borobudur (Java)", -7.6079, 110.2038],
  ["Angkor Wat", 13.4125, 103.867],
  ["Pashupatinath (Nepal)", 27.7104, 85.3487],
];

const CLOSE = 1e-9;
const near = (a: number, b: number, tol: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (Δ ${Math.abs(a - b)} > ${tol})`);

const rect = (x: number, y: number, width: number, height: number): ContentRect =>
  ({ x, y, width, height });

/** The view transform that centres a coordinate on screen at zoom `k`. */
const viewOn = (lon: number, lat: number, k: number): ViewTransform => ({
  k,
  x: FRAME.W / 2 - PX(lon) * k,
  y: FRAME.H / 2 - PY(lat) * k,
});

/* ------------------------------------------------- the frame is the frame */

test("frame matches data/geo.json, so the reference projection is the real one", async () => {
  const geo = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../../data/geo.json", import.meta.url), "utf8",
    ),
  ) as MapFrame;
  for (const key of ["W", "H", "LON0", "LON1", "LAT0", "LAT1"] as const) {
    assert.equal(FRAME[key], geo[key], `geo.json ${key} changed — update FRAME in this test`);
  }
});

/* ------------------------------------------------------ Mercator basics */

test("mercY and mercLat invert each other across the frame", () => {
  for (let lat = -80; lat <= 80; lat += 3.5) near(mercLat(mercY(lat)), lat, 1e-10, `lat ${lat}`);
});

test("the equator is the Mercator origin", () => {
  // tan(π/4) is 0.9999999999999999 in binary floating point, so this is zero to
  // within one ulp rather than exactly zero — about 10⁻¹⁰ metres on the ground.
  near(mercY(0), 0, 1e-15, "mercY(0)");
  near(mercLat(0), 0, 1e-13, "mercLat(0)");
});

test("contentX/contentY reproduce AtlasClient's PX/PY exactly", () => {
  for (const [name, lat, lng] of LANDMARKS) {
    near(contentX(FRAME, lng), PX(lng), CLOSE, `${name} x`);
    near(contentY(FRAME, lat), PY(lat), CLOSE, `${name} y`);
  }
  // and over a dense sweep, not just ten happy points
  for (let lon = FRAME.LON0; lon <= FRAME.LON1; lon += 0.5) {
    near(contentX(FRAME, lon), PX(lon), CLOSE, `sweep lon ${lon}`);
  }
  for (let lat = FRAME.LAT0; lat <= FRAME.LAT1; lat += 0.5) {
    near(contentY(FRAME, lat), PY(lat), CLOSE, `sweep lat ${lat}`);
  }
});

test("the frame corners map to the frame corners", () => {
  near(contentX(FRAME, FRAME.LON0), 0, CLOSE, "west edge");
  near(contentX(FRAME, FRAME.LON1), FRAME.W, CLOSE, "east edge");
  near(contentY(FRAME, FRAME.LAT1), 0, CLOSE, "north edge");
  near(contentY(FRAME, FRAME.LAT0), FRAME.H, CLOSE, "south edge");
});

test("contentLon/contentLat invert contentX/contentY", () => {
  for (const [name, lat, lng] of LANDMARKS) {
    near(contentLon(FRAME, contentX(FRAME, lng)), lng, 1e-10, `${name} lon`);
    near(contentLat(FRAME, contentY(FRAME, lat)), lat, 1e-10, `${name} lat`);
  }
});

test("the atlas really is a conformal Mercator — x and y share one scale", () => {
  // If this ever fails, a 3857 raster can no longer be dropped on a content
  // rect without resampling, and the whole overlay approach is invalid.
  const xScale = FRAME.W / ((FRAME.LON1 - FRAME.LON0) * (Math.PI / 180));
  const yScale = FRAME.H / (mercY(FRAME.LAT1) - mercY(FRAME.LAT0));
  near(xScale / yScale, 1, 5e-4, "x/y scale ratio");
});

test("webMercatorY is mercY in metres, and clamps at the projection's limit", () => {
  near(webMercatorY(23.5), mercY(23.5) * 6378137, 1e-6, "metres");
  assert.ok(Number.isFinite(webMercatorY(90)), "90N must clamp, not blow up to Infinity");
  assert.ok(Number.isFinite(webMercatorY(-90)));
  near(webMercatorX(180), 20037508.342789244, 1e-6, "antimeridian");
});

/* ------------------------------------------------------------ rect maths */

test("visibleContentRect is the whole frame when unzoomed", () => {
  const r = visibleContentRect(FRAME, { x: 0, y: 0, k: 1 });
  assert.deepEqual(r, { x: 0, y: 0, width: FRAME.W, height: FRAME.H });
});

test("visibleContentRect narrows and follows the pan as zoom rises", () => {
  const view: ViewTransform = { x: -400, y: -300, k: 4 };
  const r = visibleContentRect(FRAME, view);
  near(r.x, 100, CLOSE, "left");
  near(r.y, 75, CLOSE, "top");
  near(r.width, FRAME.W / 4, CLOSE, "width");
  near(r.height, FRAME.H / 4, CLOSE, "height");
});

test("visibleContentRect never escapes the frame, whatever it is handed", () => {
  for (const view of [{ x: 9e5, y: 9e5, k: 1 }, { x: -9e5, y: -9e5, k: 2 }, { x: 0, y: 0, k: 0 }]) {
    const r = visibleContentRect(FRAME, view);
    assert.ok(r.x >= 0 && r.y >= 0, `origin inside frame for ${JSON.stringify(view)}`);
    assert.ok(r.x + r.width <= FRAME.W + 1e-9 && r.y + r.height <= FRAME.H + 1e-9, "extent inside frame");
    assert.ok(r.width >= 0 && r.height >= 0, "no negative extent");
  }
});

test("boundsToRect puts north at the smaller y — SVG runs downwards", () => {
  const r = boundsToRect(FRAME, INDIA_BOUNDS);
  near(r.x, PX(INDIA_BOUNDS.west), CLOSE, "west");
  near(r.y, PY(INDIA_BOUNDS.north), CLOSE, "north");
  near(r.x + r.width, PX(INDIA_BOUNDS.east), CLOSE, "east");
  near(r.y + r.height, PY(INDIA_BOUNDS.south), CLOSE, "south");
  assert.ok(r.height > 0, "height must be positive with north at the top");
});

test("intersectRect returns the overlap, and null when there is none", () => {
  assert.deepEqual(intersectRect(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), rect(5, 5, 5, 5));
  assert.equal(intersectRect(rect(0, 0, 10, 10), rect(20, 20, 5, 5)), null);
  // touching edges share no area, which is not a drawable request
  assert.equal(intersectRect(rect(0, 0, 10, 10), rect(10, 0, 5, 5)), null);
});

test("padRect grows by a fraction of the rect and stops at the frame edge", () => {
  const r = padRect(FRAME, rect(500, 400, 100, 100), 0.1);
  assert.deepEqual(r, rect(490, 390, 120, 120));
  const clamped = padRect(FRAME, rect(0, 0, FRAME.W, FRAME.H), 0.5);
  assert.deepEqual(clamped, rect(0, 0, FRAME.W, FRAME.H));
});

test("snapRect only ever grows the rect, and lands on the grid", () => {
  const r = snapRect(FRAME, rect(101, 203, 50, 50), 100);
  assert.deepEqual(r, rect(100, 200, 100, 100));
  assert.ok(r.x <= 101 && r.x + r.width >= 151, "snapped rect must contain the original");
  assert.deepEqual(snapRect(FRAME, rect(10, 10, 5, 5), 0), rect(10, 10, 5, 5), "cell 0 is a no-op");
});

test("snapping is what makes the cache work: a small pan reuses one key", () => {
  const viewport = { width: 1000, height: 800 };
  const layer = layerById("india-state-outlines")!;
  const a = wmsRequest(layer, FRAME, { x: -900, y: -700, k: 3 }, viewport);
  const b = wmsRequest(layer, FRAME, { x: -903, y: -702, k: 3 }, viewport);
  assert.ok(a && b);
  assert.equal(a.key, b.key, "three pixels of pan must not mint a new request");
});

/* ---------------------------------------- THE ALIGNMENT PROOF (the point) */

test("a coordinate lands on the same pixel in the fetched tile as PX/PY put it", () => {
  const viewport = { width: 1440, height: 760 };
  const layer = layerById("india-state-outlines")!;
  const views: readonly ViewTransform[] = [
    { x: 0, y: 0, k: 1 },
    { x: -300, y: -420, k: 2 },
    { x: -1900, y: -1500, k: 4.5 },
    { x: -6000, y: -4200, k: 8 },
    { x: -14000, y: -11000, k: 16 },
  ];
  let checked = 0;
  for (const view of views) {
    const req = wmsRequest(layer, FRAME, view, viewport, 2);
    if (!req) continue;
    for (const [name, lat, lng] of LANDMARKS) {
      const p = placedPoint(req, lng, lat);
      // Only assert for points the request actually covers; outside the bbox
      // the extrapolation is still correct but meaningless to the reader.
      const inside =
        p.x >= req.rect.x - 1e-6 && p.x <= req.rect.x + req.rect.width + 1e-6 &&
        p.y >= req.rect.y - 1e-6 && p.y <= req.rect.y + req.rect.height + 1e-6;
      if (!inside) continue;
      near(p.x, PX(lng), 1e-6, `${name} x at k=${view.k}`);
      near(p.y, PY(lat), 1e-6, `${name} y at k=${view.k}`);
      checked++;
    }
  }
  assert.ok(checked >= 12, `expected many in-view landmark checks, ran ${checked}`);
});

test("the alignment holds for every corner of the request itself", () => {
  const req = wmsRequest(
    layerById("india-state-outlines")!, FRAME, { x: -1200, y: -900, k: 3 },
    { width: 1200, height: 800 },
  )!;
  assert.ok(req);
  const corners: readonly (readonly [number, number])[] = [
    [contentLon(FRAME, req.rect.x), contentLat(FRAME, req.rect.y)],
    [contentLon(FRAME, req.rect.x + req.rect.width), contentLat(FRAME, req.rect.y)],
    [contentLon(FRAME, req.rect.x), contentLat(FRAME, req.rect.y + req.rect.height)],
    [contentLon(FRAME, req.rect.x + req.rect.width), contentLat(FRAME, req.rect.y + req.rect.height)],
  ];
  for (const [lon, lat] of corners) {
    const p = placedPoint(req, lon, lat);
    near(p.x, PX(lon), 1e-6, `corner x ${lon}`);
    near(p.y, PY(lat), 1e-6, `corner y ${lat}`);
  }
});

test("rectToMetreBox is a plain scale of the content rect — no latitude stretch", () => {
  // The property that makes an EPSG:3857 image droppable without resampling:
  // equal content-height slices must be equal metre-height slices.
  const r = rect(200, 100, 600, 600);
  const whole = rectToMetreBox(FRAME, r);
  const top = rectToMetreBox(FRAME, rect(r.x, r.y, r.width, r.height / 2));
  const bottom = rectToMetreBox(FRAME, rect(r.x, r.y + r.height / 2, r.width, r.height / 2));
  near(top.maxY - top.minY, bottom.maxY - bottom.minY, 1e-6, "equal halves in metres");
  near((top.maxY - top.minY) + (bottom.maxY - bottom.minY), whole.maxY - whole.minY, 1e-6, "halves sum");
});

test("requested pixels are square: the image aspect matches the metre box", () => {
  const req = wmsRequest(
    layerById("india-state-outlines")!, FRAME, { x: -500, y: -900, k: 2.5 },
    { width: 1440, height: 900 },
  )!;
  const boxAspect = (req.box.maxX - req.box.minX) / (req.box.maxY - req.box.minY);
  near(req.pixelWidth / req.pixelHeight, boxAspect, 2e-3, "aspect");
});

/* -------------------------------------------------------- request shape */

test("the request is a WMS 1.1.1 GetMap in EPSG:3857 with a transparent PNG", () => {
  const req = wmsRequest(
    layerById("india-state-outlines")!, FRAME, { x: 0, y: 0, k: 1 }, { width: 1000, height: 800 },
  )!;
  const url = new URL(req.url);
  assert.equal(url.origin + url.pathname, "https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms");
  assert.equal(url.searchParams.get("service"), "WMS");
  assert.equal(url.searchParams.get("version"), "1.1.1");
  assert.equal(url.searchParams.get("request"), "GetMap");
  assert.equal(url.searchParams.get("layers"), "basemap:admin_group_ntl");
  // EPSG:4326 is plate carrée and would slide every boundary north of the equator.
  assert.equal(url.searchParams.get("srs"), "EPSG:3857");
  assert.equal(url.searchParams.get("format"), "image/png");
  assert.equal(url.searchParams.get("transparent"), "true");
  const bbox = url.searchParams.get("bbox")!.split(",").map(Number);
  assert.equal(bbox.length, 4);
  assert.ok(bbox.every(Number.isFinite), "every bbox ordinate is finite");
  assert.ok(bbox[0] < bbox[2] && bbox[1] < bbox[3], "min before max, as 1.1.1 requires");
});

test("the bbox the URL carries is the bbox the placement maths used", () => {
  const req = wmsRequest(
    layerById("india-state-outlines")!, FRAME, { x: -800, y: -600, k: 3 },
    { width: 1200, height: 700 },
  )!;
  const [minX, minY, maxX, maxY] = new URL(req.url).searchParams.get("bbox")!.split(",").map(Number);
  // URL ordinates are rounded to 0.1m; the placement uses the unrounded box.
  near(minX, req.box.minX, 0.05, "minX");
  near(minY, req.box.minY, 0.05, "minY");
  near(maxX, req.box.maxX, 0.05, "maxX");
  near(maxY, req.box.maxY, 0.05, "maxY");
});

test("a request is clipped to the layer's coverage, never wider", () => {
  const req = wmsRequest(
    layerById("india-state-outlines")!, FRAME, { x: 0, y: 0, k: 1 }, { width: 1000, height: 800 },
  )!;
  const india = boundsToRect(FRAME, INDIA_BOUNDS);
  assert.ok(req.rect.x >= india.x - 1e-9, "does not reach west of coverage");
  assert.ok(req.rect.y >= india.y - 1e-9, "does not reach north of coverage");
  assert.ok(req.rect.x + req.rect.width <= india.x + india.width + 1e-9, "not east of coverage");
  assert.ok(req.rect.y + req.rect.height <= india.y + india.height + 1e-9, "not south of coverage");
});

test("no request at all when the view has panned off the layer's coverage", () => {
  // Hard against the south-east corner of the frame: Java and the Banda Sea.
  const view: ViewTransform = { x: FRAME.W * (1 - 12), y: FRAME.H * (1 - 12), k: 12 };
  const req = wmsRequest(
    layerById("india-state-outlines")!, FRAME, view, { width: 1000, height: 800 },
  );
  assert.equal(req, null, "off-coverage must be a quiet null, not an empty fetch");
});

test("pixel size tracks zoom but stays inside the service's sane range", () => {
  const layer = layerById("india-state-areas")!;
  const viewport = { width: 1440, height: 900 };
  const zoomedOut = wmsRequest(layer, FRAME, { x: 0, y: 0, k: 1 }, viewport, 2)!;
  const zoomedIn = wmsRequest(layer, FRAME, viewOn(78.1193, 9.9195, 9), viewport, 2)!;
  assert.ok(zoomedIn, "a view centred on Madurai must be inside India's coverage");
  for (const r of [zoomedOut, zoomedIn]) {
    assert.ok(r.pixelWidth >= MIN_REQUEST_PX && r.pixelWidth <= MAX_REQUEST_PX, "width in range");
    assert.ok(r.pixelHeight >= 1 && r.pixelHeight <= MAX_REQUEST_PX, "height in range");
  }
});

test("a labelled layer is never fetched above 1x — baked type must stay legible", () => {
  const viewport = { width: 1000, height: 800 };
  const view: ViewTransform = { x: -1500, y: -1200, k: 3 };
  const outlines = wmsRequest(layerById("india-state-outlines")!, FRAME, view, viewport, 3)!;
  const areas = wmsRequest(layerById("india-state-areas")!, FRAME, view, viewport, 3)!;
  assert.ok(
    areas.pixelWidth > outlines.pixelWidth,
    "the unlabelled layer should out-resolve the labelled one at dpr 3",
  );
});

test("contentPerCssPx follows xMidYMid meet, and survives a zero-size viewport", () => {
  near(contentPerCssPx(FRAME, { width: 1480, height: 1136.5 }), 1, 1e-9, "exact fit");
  near(contentPerCssPx(FRAME, { width: 740, height: 1136.5 }), 2, 1e-9, "letterboxed by width");
  assert.equal(contentPerCssPx(FRAME, { width: 0, height: 0 }), 1, "no division by zero");
});

test("builtin layers never produce a request", () => {
  for (const layer of MAP_LAYERS.filter(isBuiltin)) {
    assert.equal(
      wmsRequest(layer, FRAME, { x: 0, y: 0, k: 1 }, { width: 900, height: 700 }), null,
      `${layer.id} must not hit the network`,
    );
  }
});

/* ------------------------------------------------------- registry rules */

test("every layer is well formed and uniquely identified", () => {
  const ids = new Set<string>();
  for (const l of MAP_LAYERS) {
    assert.ok(l.id && !ids.has(l.id), `duplicate or empty id: ${l.id}`);
    ids.add(l.id);
    assert.ok(l.label.length > 0, `${l.id} needs a label`);
    assert.ok(l.blurb.length > 0, `${l.id} needs a blurb`);
    assert.equal(layerById(l.id), l, `${l.id} must be findable by id`);
  }
});

test("a partial-coverage layer must say so — a reader may not infer the gap", () => {
  for (const l of MAP_LAYERS) {
    if (!l.coverage) continue;
    assert.ok(
      l.coverageNote.trim().length > 20,
      `${l.id} covers only part of the atlas and must carry a coverageNote`,
    );
  }
});

test("India coverage is stated from the India point of view (CLAUDE.md rule 1)", () => {
  // Gilgit-Baltistan reaches ~37.1N and Aksai Chin ~80.4E; Arunachal ~97.4E.
  // A box that stopped short of these would silently crop Indian territory.
  assert.ok(INDIA_BOUNDS.north >= 37.1, "must reach over Gilgit-Baltistan");
  assert.ok(INDIA_BOUNDS.east >= 97.4, "must reach the eastern tip of Arunachal Pradesh");
  assert.ok(INDIA_BOUNDS.south <= 6.8, "must reach Indira Point in the Nicobars");
  assert.ok(INDIA_BOUNDS.west <= 68.1, "must reach the Gujarat coast and Lakshadweep");
});

test("every remote layer carries an attribution and starts switched off", () => {
  for (const l of MAP_LAYERS.filter(isWms)) {
    assert.ok(l.attribution.trim().length > 0, `${l.id} must credit its service`);
    assert.equal(l.defaultOn, false, `${l.id} costs someone else's servers; it must be opt-in`);
    assert.ok(l.source.timeoutMs > 0, `${l.id} needs a timeout so a dead service cannot hang`);
    // Crediting a live third-party service is a condition of using it, so the
    // credit cannot be hidden behind a panel the reader may never open.
    assert.equal(l.attributionOnMap, true, `${l.id} must credit its service on the map itself`);
  }
});

test("nothing is painted over the map until a layer that requires it is on", () => {
  // The default map carries no permanent credit box: the only sources on at
  // start ship inside this repo and are credited in the panel instead.
  assert.deepEqual(activeAttributions(defaultLayerState()), []);
  for (const l of MAP_LAYERS) {
    if (l.attributionOnMap) assert.ok(l.attribution.trim().length > 0, `${l.id} has nothing to paint`);
  }
});

test("a layer with unconfirmed terms may not be on by default", () => {
  for (const l of MAP_LAYERS) {
    if (l.terms.status !== "unconfirmed") continue;
    assert.equal(l.defaultOn, false, `${l.id} has unconfirmed terms and must not auto-load`);
    assert.ok(l.terms.note.trim().length > 40, `${l.id} must explain the position in plain words`);
  }
});

test("defaultLayerState covers every layer and hands back a fresh object", () => {
  const a = defaultLayerState(), b = defaultLayerState();
  assert.deepEqual(Object.keys(a).sort(), MAP_LAYERS.map((l) => l.id).sort());
  assert.notEqual(a, b, "callers must own their copy, not share one");
  for (const l of MAP_LAYERS) assert.equal(a[l.id], l.defaultOn);
});

test("builtinOffClasses names only the builtin layers that are switched off", () => {
  assert.equal(builtinOffClasses(defaultLayerState()), "", "defaults are all on");
  const off = { ...defaultLayerState(), graticule: false, "india-state-outlines": true };
  assert.equal(builtinOffClasses(off), "no-graticule", "WMS layers contribute no class");
});

test("attribution and terms surface exactly while their layer is on", () => {
  const off = defaultLayerState();
  assert.deepEqual(activeTermsNotes(off), [], "nothing unconfirmed is on at start");

  const on = { ...off, "india-state-outlines": true };
  const credits = activeAttributions(on);
  assert.ok(credits.some((c) => /NRSC|ISRO/.test(c)), "ISRO/NRSC must be credited while on");
  const notes = activeTermsNotes(on);
  assert.equal(notes.length, 1, "the unconfirmed-terms note must be shown");
  assert.match(notes[0], /unconfirmed/i);

  // Both Bhuvan layers share one credit and one note; the reader sees each once.
  const both = { ...on, "india-state-areas": true };
  assert.deepEqual(activeAttributions(both), credits, "no duplicate credits");
  assert.equal(activeTermsNotes(both).length, 1, "no duplicate notes");
});

test("isWms and isBuiltin partition the registry", () => {
  const wms = MAP_LAYERS.filter(isWms), builtin = MAP_LAYERS.filter(isBuiltin);
  assert.equal(wms.length + builtin.length, MAP_LAYERS.length);
  assert.ok(wms.length > 0 && builtin.length > 0, "both kinds should be exercised");
});

test("padding is a modest halo, not a second screenful", () => {
  assert.ok(REQUEST_PADDING > 0 && REQUEST_PADDING <= 0.25, "padding must stay cheap");
});

test("adding a layer really is one entry — the registry is the only wiring", () => {
  // A locally declared layer flows straight through the request builder with no
  // registration step anywhere else. This is the guarantee the brief asked for.
  const invented: MapLayer = {
    id: "invented", label: "Invented", blurb: "Proof that one entry is enough.",
    defaultOn: false, coverage: INDIA_BOUNDS, coverageNote: "India only, as it happens.",
    attribution: "Nobody", terms: { status: "pinned", note: "Fictional." },
    source: {
      kind: "wms", endpoint: "https://example.invalid/wms", layers: "x:y",
      version: "1.1.1", format: "image/png", maxPixelRatio: 2, timeoutMs: 1000,
    },
  };
  const req = wmsRequest(invented, FRAME, { x: -600, y: -500, k: 2 }, { width: 900, height: 700 })!;
  assert.ok(req.url.startsWith("https://example.invalid/wms?"));
  assert.equal(req.layerId, "invented");
  const p = placedPoint(req, 78.1193, 9.9195);
  near(p.x, PX(78.1193), 1e-6, "invented layer aligns like any other");
  near(p.y, PY(9.9195), 1e-6, "invented layer aligns like any other");
});
