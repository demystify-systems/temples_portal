/**
 * Map layers — the registry, and the projection maths that lands a remote
 * raster exactly on the atlas.
 *
 * WHERE LAYERS ARE ADDED
 * ----------------------
 * `MAP_LAYERS` below. One entry per layer, and nothing else in the codebase
 * needs to know a layer exists: `LayerControl` renders the registry, and
 * `AtlasClient` walks the registry to decide what to fetch and where to put it.
 * Adding a layer is one object literal. Removing one is deleting it.
 *
 * TWO KINDS OF LAYER
 * ------------------
 *  - `builtin` — geometry already inside `data/geo.json`, drawn by the map
 *    itself. Toggling one flips a class on the map wrapper; no network at all.
 *  - `wms`     — a raster fetched live from an OGC Web Map Service and placed
 *    under the site marks as an `<image>`.
 *
 * BOUNDARY COMPLIANCE (CLAUDE.md rule 1)
 * --------------------------------------
 * Every entry here is additive. Nothing in this file regenerates, patches or
 * reprojects `data/geo.json`, which remains the sole India-point-of-view
 * country geometry. A layer whose point of view has not been *visually*
 * verified must not be added — see `data/boundaries/README.md` for the
 * verification record and for why Natural Earth's admin_1 layer is banned.
 *
 * PROJECTION
 * ----------
 * The atlas is a spherical Mercator: longitude is linear across `W`, latitude
 * is linear in `mercY` across `H`. Web Mercator (EPSG:3857) is the same
 * projection in metres, so the content grid and a 3857 tile differ by nothing
 * but an affine scale — a 3857 image dropped on the matching content rect is
 * pixel-exact, with no resampling and no per-row correction. That is the whole
 * reason requests go out in EPSG:3857 and not in the EPSG:4326 the service
 * documents first: EPSG:4326 is plate carrée, which is *not* this map, and
 * stretching it linearly would slide every boundary north of the equator.
 */

/* ------------------------------------------------------------------ frame */

/** The atlas's own coordinate box — `GEO` from `src/lib/sites.ts`. */
export type MapFrame = {
  readonly W: number;
  readonly H: number;
  readonly LON0: number;
  readonly LON1: number;
  readonly LAT0: number;
  readonly LAT1: number;
};

/** The world group's transform: `translate(x y) scale(k)`. */
export type ViewTransform = { readonly x: number; readonly y: number; readonly k: number };

/** Rendered size of the map element, in CSS pixels. */
export type ViewportPx = { readonly width: number; readonly height: number };

/** A degrees box. `north`/`south` are latitudes, `west`/`east` longitudes. */
export type GeoBounds = {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
};

/** A box in the map's own content coordinates (the SVG viewBox space). */
export type ContentRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** An EPSG:3857 bounding box in metres, in the order WMS 1.1.1 wants it. */
export type MetreBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/* ------------------------------------------------------- Mercator maths */

const DEG = Math.PI / 180;

/** Spherical Mercator northing, in radians of the unit sphere. */
export const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));

/** Inverse of `mercY`, back to degrees. */
export const mercLat = (y: number): number => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;

/**
 * Longitude to content x. This is `PX` in AtlasClient, and
 * `layers.test.ts` pins the two together so they cannot drift apart.
 */
export const contentX = (frame: MapFrame, lon: number): number =>
  ((lon - frame.LON0) / (frame.LON1 - frame.LON0)) * frame.W;

/** Latitude to content y. This is `PY` in AtlasClient. */
export const contentY = (frame: MapFrame, lat: number): number => {
  const top = mercY(frame.LAT1);
  return ((top - mercY(lat)) / (top - mercY(frame.LAT0))) * frame.H;
};

/** Content x back to longitude. */
export const contentLon = (frame: MapFrame, x: number): number =>
  frame.LON0 + (x / frame.W) * (frame.LON1 - frame.LON0);

/** Content y back to latitude. */
export const contentLat = (frame: MapFrame, y: number): number => {
  const top = mercY(frame.LAT1);
  return mercLat(top - (y / frame.H) * (top - mercY(frame.LAT0)));
};

/** Earth radius used by EPSG:3857, and the latitude where that projection ends. */
export const WEB_MERCATOR_RADIUS = 6378137;
export const WEB_MERCATOR_MAX_LAT = 85.0511287798066;

export const webMercatorX = (lon: number): number => lon * DEG * WEB_MERCATOR_RADIUS;

export const webMercatorY = (lat: number): number =>
  mercY(clamp(lat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT)) * WEB_MERCATOR_RADIUS;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Collapse `-0` to `0`. `-view.x / k` is negative zero at the home view, which
 * compares equal to zero but is not deep-equal to it, and reaches the DOM as
 * the string "-0". Rect maths is the only place it can appear, so it is
 * normalised there rather than everywhere downstream.
 */
const zero = (v: number): number => v + 0;

/* ---------------------------------------------------------- view → rect */

/**
 * The slice of content the viewer can currently see.
 *
 * A screen point `s` in viewBox space is `content * k + t`, so the visible
 * content is `(0 - t)/k` to `(size - t)/k`. `clampTranslate` already keeps the
 * result inside the frame; clamping again here means a caller that has not
 * gone through the gesture pipeline still cannot ask for a bbox off the world.
 */
export const visibleContentRect = (frame: MapFrame, view: ViewTransform): ContentRect => {
  const k = view.k > 0 ? view.k : 1;
  const x0 = zero(clamp(-view.x / k, 0, frame.W));
  const y0 = zero(clamp(-view.y / k, 0, frame.H));
  const x1 = clamp((frame.W - view.x) / k, x0, frame.W);
  const y1 = clamp((frame.H - view.y) / k, y0, frame.H);
  return { x: x0, y: y0, width: zero(x1 - x0), height: zero(y1 - y0) };
};

/** A degrees box as a content rect. `north` is the *smaller* y — SVG runs down. */
export const boundsToRect = (frame: MapFrame, b: GeoBounds): ContentRect => {
  const x = contentX(frame, b.west);
  const y = contentY(frame, b.north);
  return { x, y, width: contentX(frame, b.east) - x, height: contentY(frame, b.south) - y };
};

/** Overlap of two content rects, or null when they do not touch. */
export const intersectRect = (a: ContentRect, b: ContentRect): ContentRect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (!(right > x) || !(bottom > y)) return null;
  return { x, y, width: right - x, height: bottom - y };
};

/** Grow a rect by a fraction of its own size, staying inside `frame`. */
export const padRect = (frame: MapFrame, r: ContentRect, fraction: number): ContentRect => {
  const dx = r.width * fraction;
  const dy = r.height * fraction;
  const x = clamp(r.x - dx, 0, frame.W);
  const y = clamp(r.y - dy, 0, frame.H);
  const right = clamp(r.x + r.width + dx, x, frame.W);
  const bottom = clamp(r.y + r.height + dy, y, frame.H);
  return { x, y, width: right - x, height: bottom - y };
};

/**
 * Snap a rect out to a grid so that panning a few pixels reuses the last
 * request instead of minting a new URL. `cell` is in content units; edges go
 * outward, so the snapped rect always contains the original.
 */
export const snapRect = (frame: MapFrame, r: ContentRect, cell: number): ContentRect => {
  if (!(cell > 0)) return r;
  const x = clamp(Math.floor(r.x / cell) * cell, 0, frame.W);
  const y = clamp(Math.floor(r.y / cell) * cell, 0, frame.H);
  const right = clamp(Math.ceil((r.x + r.width) / cell) * cell, x, frame.W);
  const bottom = clamp(Math.ceil((r.y + r.height) / cell) * cell, y, frame.H);
  return { x, y, width: right - x, height: bottom - y };
};

/** A content rect as the EPSG:3857 box a WMS GetMap wants. */
export const rectToMetreBox = (frame: MapFrame, r: ContentRect): MetreBox => ({
  minX: webMercatorX(contentLon(frame, r.x)),
  minY: webMercatorY(contentLat(frame, r.y + r.height)),
  maxX: webMercatorX(contentLon(frame, r.x + r.width)),
  maxY: webMercatorY(contentLat(frame, r.y)),
});

/* ----------------------------------------------------------- the registry */

/** A live OGC Web Map Service raster. */
export type WmsSource = {
  readonly kind: "wms";
  readonly endpoint: string;
  /** The service's own layer name(s), comma separated. */
  readonly layers: string;
  readonly version: "1.1.1";
  readonly format: string;
  /**
   * Device-pixel multiplier for the request. Layers whose rasters carry baked
   * labels stay at 1: the service draws type at a fixed pixel size, so asking
   * for a 2x image and scaling it down turns every place name into a smudge.
   */
  readonly maxPixelRatio: number;
  /** Abandon the image after this long and leave the map exactly as it was. */
  readonly timeoutMs: number;
};

/** Geometry already in `data/geo.json`; toggling it is a CSS class, not a fetch. */
export type BuiltinSource = {
  readonly kind: "builtin";
  /** Class put on the map wrapper while the layer is OFF. */
  readonly offClass: string;
};

export type LayerSource = WmsSource | BuiltinSource;

/** Licence position for a layer's underlying data. Displayed, never inferred. */
export type LayerTerms = {
  readonly status: "pinned" | "unconfirmed";
  /** Shown to the reader verbatim while the layer is on. Keep it plain. */
  readonly note: string;
};

export type MapLayer = {
  readonly id: string;
  /** Control label. */
  readonly label: string;
  /** One line under the label, explaining what the layer actually is. */
  readonly blurb: string;
  /**
   * Whether the layer starts on. A layer that costs someone else's servers, or
   * whose terms are not pinned, starts OFF and is never persisted on.
   */
  readonly defaultOn: boolean;
  /** Where the layer has data at all. Null means "the whole frame". */
  readonly coverage: GeoBounds | null;
  /**
   * Stated in the control whenever coverage is partial. A reader must never be
   * left to infer that a country with no state lines drawn has no states.
   */
  readonly coverageNote: string;
  /** Who to credit. Empty when the layer is ours and there is nobody to credit. */
  readonly attribution: string;
  /**
   * Whether that credit must be painted on the map itself rather than shown in
   * the panel. True for anything served live from someone else's infrastructure
   * — that credit is a condition of use, so it stays on screen whether or not
   * the reader has the panel open. False for sources we already ship in the
   * repo, which are credited in the panel and do not need a permanent overlay.
   */
  readonly attributionOnMap: boolean;
  readonly terms: LayerTerms;
  readonly source: LayerSource;
};

/**
 * India's extent as this atlas states it — the India point of view, so the box
 * reaches north over Gilgit-Baltistan and east over Aksai Chin and the whole of
 * Arunachal Pradesh, and south to Indira Point in the Nicobars.
 */
export const INDIA_BOUNDS: GeoBounds = { west: 67.8, south: 6.5, east: 97.6, north: 37.4 };

const BHUVAN_WMS = "https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms";
const BHUVAN_ATTRIBUTION = "State boundaries © Bhuvan, NRSC / ISRO, Government of India";
const BHUVAN_TERMS: LayerTerms = {
  status: "unconfirmed",
  note:
    "Served live from ISRO's Bhuvan servers. Bhuvan publishes no reachable terms-of-use " +
    "page, so redistribution rights are unconfirmed — this layer is off by default and " +
    "is never fetched unless you switch it on.",
};

/**
 * THE REGISTRY. Add a layer by adding an entry.
 *
 * Order is the order the control lists them, and — for WMS layers — the order
 * they stack under the site marks.
 */
export const MAP_LAYERS: readonly MapLayer[] = [
  {
    id: "graticule",
    label: "Graticule",
    blurb: "Ten-degree latitude and longitude grid.",
    defaultOn: true,
    coverage: null,
    coverageNote: "",
    attribution: "",
    attributionOnMap: false,
    terms: { status: "pinned", note: "Generated from the map frame; no third-party data." },
    source: { kind: "builtin", offClass: "no-graticule" },
  },
  {
    id: "countries",
    label: "Country outlines",
    blurb: "National borders, India point of view, from data/geo.json.",
    defaultOn: true,
    coverage: null,
    coverageNote: "",
    attribution: "Country geometry: Natural Earth (India worldview edition)",
    // Shipped in the repo, so the credit belongs in the panel, not permanently
    // painted over the map.
    attributionOnMap: false,
    terms: {
      status: "pinned",
      note: "Natural Earth is public domain. Built from ne_10m_admin_0_countries_ind.",
    },
    source: { kind: "builtin", offClass: "no-countries" },
  },
  {
    id: "india-state-outlines",
    label: "State boundaries — India",
    blurb: "State and union-territory outlines with names, drawn by ISRO's Bhuvan service.",
    defaultOn: false,
    coverage: INDIA_BOUNDS,
    coverageNote:
      "India only. No equivalent India-point-of-view state layer exists for the other " +
      "14 countries in this atlas, so their internal boundaries are simply not drawn — " +
      "that is a gap in our sources, not a statement about those countries.",
    attribution: BHUVAN_ATTRIBUTION,
    attributionOnMap: true,
    terms: BHUVAN_TERMS,
    source: {
      kind: "wms",
      endpoint: BHUVAN_WMS,
      layers: "basemap:admin_group_ntl",
      version: "1.1.1",
      format: "image/png",
      // Labels are baked into the raster at a fixed pixel size.
      maxPixelRatio: 1,
      timeoutMs: 9000,
    },
  },
  {
    id: "india-state-areas",
    label: "State areas — India",
    blurb: "The same states as filled tints instead of outlines. Heavier; no names.",
    defaultOn: false,
    coverage: INDIA_BOUNDS,
    coverageNote:
      "India only, for the same reason as the outline layer above.",
    attribution: BHUVAN_ATTRIBUTION,
    attributionOnMap: true,
    terms: BHUVAN_TERMS,
    source: {
      kind: "wms",
      endpoint: BHUVAN_WMS,
      layers: "state_ql_new",
      version: "1.1.1",
      format: "image/png",
      // No baked type, so a retina request is pure gain.
      maxPixelRatio: 2,
      timeoutMs: 9000,
    },
  },
];

export const layerById = (id: string): MapLayer | undefined => MAP_LAYERS.find((l) => l.id === id);

/**
 * What a layer is doing right now.
 *
 * `unavailable` is a first-class, undramatic state: a live service is allowed
 * to be down, and when it is, the map carries on and the control says so. It
 * is the only place a reader ever learns a fetch failed — nothing on the map
 * itself changes, and no broken image is ever rendered.
 */
export type LayerStatus = "off" | "loading" | "ready" | "unavailable" | "out-of-view";

/** Status wording, kept here so it is pure and pinned by a test. */
export const layerStatusText = (status: LayerStatus): string => {
  switch (status) {
    case "loading": return "loading…";
    case "ready": return "shown";
    case "unavailable": return "service unreachable — the map is unaffected";
    case "out-of-view": return "no coverage in this view";
    case "off": return "";
  }
};

/**
 * District boundaries, and why there are none. Stated in the control rather
 * than left as a silent absence: the reader asked for districts and deserves
 * the reason. The full probe log is in data/boundaries/README.md.
 */
export const DISTRICT_NOTE =
  "District boundaries are not available. Bhuvan serves districts per state, not " +
  "nationally, and none of the per-state layer names resolve on the public endpoint.";

export const isWms = (l: MapLayer): l is MapLayer & { source: WmsSource } => l.source.kind === "wms";

export const isBuiltin = (l: MapLayer): l is MapLayer & { source: BuiltinSource } =>
  l.source.kind === "builtin";

/** Starting on/off state. Deliberately a fresh object: callers own their copy. */
export const defaultLayerState = (): Record<string, boolean> =>
  Object.fromEntries(MAP_LAYERS.map((l) => [l.id, l.defaultOn]));

/** Classes for the map wrapper: one `offClass` per builtin layer that is off. */
export const builtinOffClasses = (on: Readonly<Record<string, boolean>>): string =>
  MAP_LAYERS.filter(isBuiltin)
    .filter((l) => !on[l.id])
    .map((l) => l.source.offClass)
    .join(" ");

/**
 * Credits that must be painted on the map right now, deduplicated, in registry
 * order. Only layers with `attributionOnMap` qualify — see the field's note.
 */
export const activeAttributions = (on: Readonly<Record<string, boolean>>): readonly string[] => [
  ...new Set(
    MAP_LAYERS.filter((l) => on[l.id] && l.attribution && l.attributionOnMap).map((l) => l.attribution),
  ),
];

/** Terms notes that must be on screen right now — every unconfirmed one, always. */
export const activeTermsNotes = (on: Readonly<Record<string, boolean>>): readonly string[] => [
  ...new Set(
    MAP_LAYERS.filter((l) => on[l.id] && l.terms.status === "unconfirmed").map((l) => l.terms.note),
  ),
];

/* ------------------------------------------------------- request building */

/** Fraction of the viewport fetched beyond its edges, so a small pan is free. */
export const REQUEST_PADDING = 0.14;
/** The snap grid is the padded frame divided this many ways at the current zoom. */
export const SNAP_DIVISIONS = 6;
/** Floor and ceiling on the pixel size asked of the service. */
export const MIN_REQUEST_PX = 256;
export const MAX_REQUEST_PX = 2048;
/** Quiet period after the last view change before a refetch goes out. */
export const REFRESH_DEBOUNCE_MS = 400;
/** How many request keys to remember per session. */
export const REQUEST_CACHE_LIMIT = 64;

export type LayerRequest = {
  readonly layerId: string;
  /** Cache key and identity: same key means the same bytes. */
  readonly key: string;
  readonly url: string;
  /** Where to put the returned image, in content coordinates. */
  readonly rect: ContentRect;
  readonly box: MetreBox;
  /** Pixel size asked of the service. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
};

/**
 * Content units per CSS pixel for `preserveAspectRatio="xMidYMid meet"` — the
 * same rule `viewportScale` in map-gestures.ts applies to pointer coordinates.
 */
export const contentPerCssPx = (frame: MapFrame, viewport: ViewportPx): number => {
  if (!(viewport.width > 0) || !(viewport.height > 0)) return 1;
  return Math.max(frame.W / viewport.width, frame.H / viewport.height);
};

/**
 * Build the GetMap request for a layer at the current view, or null when there
 * is nothing to ask for — the layer has no data in shot, or the view is
 * degenerate. Returning null is a normal outcome, not an error: pan away from
 * India with the state layer on and the overlay simply has nothing to draw.
 */
export const wmsRequest = (
  layer: MapLayer,
  frame: MapFrame,
  view: ViewTransform,
  viewport: ViewportPx,
  devicePixelRatio = 1,
): LayerRequest | null => {
  if (!isWms(layer)) return null;

  const visible = visibleContentRect(frame, view);
  if (!(visible.width > 0) || !(visible.height > 0)) return null;

  const padded = padRect(frame, visible, REQUEST_PADDING);

  // Snap on a grid that shrinks with zoom, so the cache keeps working at every
  // scale: one cell is always about a sixth of what is on screen.
  const cell = frame.W / (SNAP_DIVISIONS * Math.max(view.k, 1));
  const snapped = snapRect(frame, padded, cell);

  // Clip to coverage *after* snapping. Snapping grows the rect outward, so
  // clipping first would let a whole cell of empty ocean back in on every edge
  // — and the request would claim ground the layer has no data for. Both the
  // grid and the coverage box are fixed, so the key stays just as stable.
  const rect = layer.coverage
    ? intersectRect(snapped, boundsToRect(frame, layer.coverage))
    : snapped;
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;

  const box = rectToMetreBox(frame, rect);
  const boxWidth = box.maxX - box.minX;
  const boxHeight = box.maxY - box.minY;
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null;

  // Ask for roughly one image pixel per pixel the rect actually occupies.
  const cssPerContent = view.k / contentPerCssPx(frame, viewport);
  const ratio = Math.max(1, Math.min(devicePixelRatio, layer.source.maxPixelRatio));
  const pixelWidth = Math.round(
    clamp(rect.width * cssPerContent * ratio, MIN_REQUEST_PX, MAX_REQUEST_PX),
  );
  // Height follows the *metre* box, not the rect, so pixels stay square even if
  // the frame is ever re-cut to something that is not a true Mercator.
  const pixelHeight = Math.max(1, Math.min(MAX_REQUEST_PX, Math.round((pixelWidth * boxHeight) / boxWidth)));

  const params = new URLSearchParams({
    service: "WMS",
    version: layer.source.version,
    request: "GetMap",
    layers: layer.source.layers,
    styles: "",
    bbox: [box.minX, box.minY, box.maxX, box.maxY].map((v) => v.toFixed(1)).join(","),
    width: String(pixelWidth),
    height: String(pixelHeight),
    // WMS 1.1.1 spells it `srs`; 1.3.0 renames it `crs` and flips axis order.
    srs: "EPSG:3857",
    format: layer.source.format,
    transparent: "true",
  });
  const url = `${layer.source.endpoint}?${params.toString()}`;
  return { layerId: layer.id, key: `${layer.id}|${url}`, url, rect, box, pixelWidth, pixelHeight };
};

/**
 * Where a coordinate lands inside a built request, in content units.
 *
 * This is the inverse of the whole chain — content → degrees → metres → bbox →
 * placed image — and `layers.test.ts` asserts it reproduces `PX`/`PY` exactly.
 * If it ever does not, the overlay is drawn in the wrong place and the test is
 * the only thing that will say so.
 */
export const placedPoint = (
  request: LayerRequest,
  lon: number,
  lat: number,
): { readonly x: number; readonly y: number } => {
  const { box, rect } = request;
  const fx = (webMercatorX(lon) - box.minX) / (box.maxX - box.minX);
  const fy = (box.maxY - webMercatorY(lat)) / (box.maxY - box.minY);
  return { x: rect.x + fx * rect.width, y: rect.y + fy * rect.height };
};
