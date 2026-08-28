"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
// NOT "@/lib/sites". That module does `import rawSites from "data/sites.json"`,
// so importing ANYTHING from it — even a pure helper or a stats function —
// inlines all 3,031 records into this client chunk. That is exactly the bug
// this page had: 922.1 kB in one chunk, 1,025.7 kB of JS on the homepage.
// site-utils is the corpus-free half of that module and is safe to import.
import { ERAS, eraOf, appearYear, fmtYear, gmapsUrl } from "@/lib/site-utils";
import { MAP_SITES, MAP_SITE_BY_ID, type MapSite } from "@/lib/map-sites";
import { MAP_BOX } from "@/lib/generated/map-projection";
import { ATLAS_STATS } from "@/lib/generated/atlas-stats";
import { loadRecord, type RecordDetail } from "@/lib/record-detail";
import { readVerification } from "@/lib/verification";
import { useSpellingHelp } from "./useSpellingHelp";
import {
  DOUBLE_TAP_ZOOM, TAP_SLOP_PX, clampTranslate, distance, isDoubleTap, midpoint, pinchFactor,
  scaleAbout, toStagePoint, translateBy, viewportScale, wheelZoomFactor,
  type Point, type Tap, type View,
} from "@/lib/map-gestures";
import {
  cellSizeFor, clusterAriaLabel, clusterPoints, clusterRadius, donutArcs, pipOffsets,
  shouldCluster, viewForBounds, type Cluster, type ClusterPoint,
} from "@/lib/cluster";
import {
  CIRCUIT_ORDER_NOTE, CONTESTED_BADGE, badgeFor, circuitRoute, contestsCircuit,
  domIdFor, focusOrder, keyIntent, resolveMove, targetFromDomId,
  type CircuitRoute, type FocusTarget,
} from "@/lib/map-keyboard";
import {
  MAP_LAYERS, REFRESH_DEBOUNCE_MS, REQUEST_CACHE_LIMIT, builtinOffClasses, defaultLayerState,
  isWms, wmsRequest, type ContentRect, type LayerRequest, type LayerStatus, type MapFrame, type MapLayer,
} from "@/lib/layers";
import SiteHeader from "./SiteHeader";
import LayerControl from "./LayerControl";

const { W, H, LON0, LON1, LAT0, LAT1 } = MAP_BOX;
/** The map's own coordinate box. Every gesture is clamped to it. */
const EXTENT = { width: W, height: H };
/** The same box as the layer maths wants it. `layers.test.ts` pins the two together. */
const FRAME: MapFrame = { W, H, LON0, LON1, LAT0, LAT1 };
const mercY = (t: number) => Math.log(Math.tan(Math.PI / 4 + (t * Math.PI) / 180 / 2));
const YT = mercY(LAT1), YB = mercY(LAT0);
const PX = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * W;
const PY = (lat: number) => ((YT - mercY(lat)) / (YT - YB)) * H;
const TRADS: Record<string, string> = { Hindu: "circle", Buddhist: "square", Jain: "diamond", Sikh: "triangle" };
const YEAR_MIN = -650, YEAR_MAX = 2030;

/** Stated in words, not carried by italics. See the katha section below. */
const KATHA_FRAMING =
  "What follows is sthala katha — the temple’s own traditional account, transmitted through liturgy and local memory. It is recorded here as tradition, not as attested history.";
/** Computed at BUILD time (scripts/build-map-artefacts.mjs), never in the browser. */
const STATS = ATLAS_STATS;
const ERA_NAMES = ERAS.map((e) => e.name);
/** Id lookup. `ringSpot` runs once per animation frame; a linear scan there is not free. */
const SITE_BY_ID = MAP_SITE_BY_ID;

/** Below this width the detail rail becomes a bottom sheet (T-041). */
const SHEET_QUERY = "(max-width: 720px)";
/** Sheet snap points, as translateY percentages of the sheet's own height. */
const SNAPS = { full: 6, half: 46, peek: 78 } as const;
type SnapName = keyof typeof SNAPS;
const SNAP_ORDER: readonly SnapName[] = ["full", "half", "peek"];
/** Dragged past this, or flicked down faster than this, and the sheet closes. */
const SHEET_DISMISS_PCT = 90;
const SHEET_FLICK_PCT_PER_MS = 0.14;
const COACH_KEY = "tirtha.coach.timeline.v1";
/** Long enough for the opening timeline sweep to finish before the hint lands. */
const COACH_DELAY_MS = 2200;
/** Zoom quantisation for the cluster cache: ~7% steps. See `ensureLayout`. */
const ZOOM_STEPS_PER_OCTAVE = 10;

function eraColor(i: number) {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(`--e${i + 1}`).trim();
}
function shapePath(kind: string, r: number) {
  if (kind === "square") { const a = r * 0.9; return `M${-a} ${-a}H${a}V${a}H${-a}Z`; }
  if (kind === "diamond") { const a = r * 1.25; return `M0 ${-a}L${a} 0L0 ${a}L${-a} 0Z`; }
  if (kind === "triangle") { const a = r * 1.3; return `M0 ${-a}L${a * 0.9} ${a * 0.75}L${-a * 0.9} ${a * 0.75}Z`; }
  return "";
}

/** Everything that reaches innerHTML goes through this: site data is not markup. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Nearest sheet snap to a translateY percentage. Pure; ties resolve toward more content. */
function nearestSnap(pct: number): SnapName {
  let best: SnapName = "half", bestDelta = Infinity;
  for (const name of SNAP_ORDER) {
    const delta = Math.abs(SNAPS[name] - pct);
    if (delta < bestDelta) { bestDelta = delta; best = name; }
  }
  return best;
}

/** localStorage throws outright in some privacy contexts, so every touch is guarded. */
const readFlag = (key: string): string | null => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const writeFlag = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked; the hint simply returns */ }
};

const byDomId = (id: string) =>
  (document.getElementById(id) as (Element & { focus?: (o?: FocusOptions) => void }) | null);

type Filters = { q: string; country: string; trad: string; dyn: string; cir: string };
const EMPTY: Filters = { q: "", country: "", trad: "", dyn: "", cir: "" };

function visible(s: MapSite, f: Filters, from: number, to: number) {
  // A RANGE, not a ceiling. The single-handle version could only ever answer
  // "what existed by year N", so isolating an era meant reading the colours off
  // a map that still showed everything older. Two handles answer the question
  // people actually have: show me the temples of THIS period.
  const appeared = appearYear(s);
  // YEAR_MIN is where the SLIDER stops, not where the corpus does. Thirteen
  // records carry an `origin` older than it — Kashi Vishwanath at 1500 BCE,
  // Krishna Janmabhoomi at 3100 BCE, Somnath, Kedarnath, Ayodhya — because
  // `origin` is first attestation as a sacred site, not the standing structure.
  // Treating the handle's floor as a filter would quietly drop some of the most
  // significant records in the atlas from the default view, so at rest the lower
  // bound means "no lower bound".
  if (from > YEAR_MIN && appeared < from) return false;
  if (appeared > to) return false;
  if (f.country && s.country !== f.country) return false;
  if (f.trad && s.tradition !== f.trad) return false;
  if (f.dyn && s.dynasty !== f.dyn) return false;
  if (f.cir && !(s.circuits ?? []).includes(f.cir)) return false;
  if (f.q) {
    const hay = `${s.name} ${s.alt ?? ""} ${s.place} ${s.state ?? ""} ${s.country} ${s.deity} ${s.dynasty}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

export default function AtlasClient({ outlines }: { readonly outlines: string }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  /**
   * The visible period, as [from, to].
   *
   * `to` alone reproduces the old behaviour — drag it and watch temples rise —
   * so the play sweep and the coach mark still describe something true. `from`
   * is what is new: raising it hides everything older, which is the only way to
   * see one era on its own.
   */
  const [range, setRange] = useState<readonly [number, number]>([YEAR_MIN, YEAR_MAX]);
  const [from, year] = range;
  const setYear = useCallback((next: number | ((y: number) => number)) => {
    setRange(([lo, hi]) => {
      const value = typeof next === "function" ? next(hi) : next;
      // The handles may meet but never cross; a crossed range shows nothing and
      // reads as a broken control rather than an empty result.
      return [Math.min(lo, value), Math.max(lo, value)];
    });
  }, []);
  const setFrom = useCallback((value: number) => {
    setRange(([, hi]) => [Math.min(value, hi), hi]);
  }, []);
  const [sel, setSel] = useState<string | null>(null);
  const [index, setIndex] = useState(false);
  const [circuit, setCircuit] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [shownCount, setShownCount] = useState(MAP_SITES.length);
  const [fOpen, setFOpen] = useState(false);
  const [isSheet, setIsSheet] = useState(false);
  const [snap, setSnap] = useState<SnapName>("half");
  const [dragging, setDragging] = useState(false);
  const [coach, setCoach] = useState(false);

  // Opening the index always clears the site panel — they share the one side rail.
  const toggleIndex = useCallback(() => { setIndex((v) => !v); setSel(null); }, []);

  const mapRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const ptsRef = useRef<SVGGElement>(null);
  const clustersRef = useRef<SVGGElement>(null);
  const badgeRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const tlRef = useRef<SVGSVGElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const marks = useRef(new Map<string, { g: SVGGElement; mark: SVGElement; halo: SVGCircleElement; kind: string }>());
  const yearRef = useRef(year); yearRef.current = year;
  const fromRef = useRef(from); fromRef.current = from;
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const selRef = useRef(sel); selRef.current = sel;
  const circuitRef = useRef(circuit); circuitRef.current = circuit;

  /** Cached cluster layout. Rebuilt only when the *answer* can have changed. */
  const layout = useRef<{ key: string; clusters: Cluster[]; clustered: Set<string> }>(
    { key: "", clusters: [], clustered: new Set() },
  );
  /** Ids of the marks that are actually drawn, in filtered order: the tab order. */
  const markOrder = useRef<string[]>([]);
  /** What the map's keyboard focus is on, and whether it earned a visible ring. */
  const focused = useRef<FocusTarget | null>(null);
  const ringVisible = useRef(false);
  /** The mark to hand focus back to when the panel closes. */
  const returnTo = useRef<string | null>(null);
  /** Circuit badge elements by site id, so a badge can be hidden with its mark. */
  const badgeEls = useRef(new Map<string, SVGTextElement>());

  const lists = useMemo(() => ({
    countries: [...new Set(MAP_SITES.map((s) => s.country))].sort(),
    trads: [...new Set(MAP_SITES.map((s) => s.tradition))].sort(),
    dyns: [...new Set(MAP_SITES.map((s) => s.dynasty))].sort(),
    cirs: [...new Set(MAP_SITES.flatMap((s) => s.circuits ?? []))].sort(),
  }), []);

  // ---- map layers ---------------------------------------------------------
  // Everything a layer is lives in `MAP_LAYERS` (src/lib/layers.ts). This block
  // only *drives* the registry: it never names a layer.
  //
  // Two rules are load-bearing rather than stylistic:
  //  1. A remote layer is fetched only while it is switched on. There is no
  //     prefetch and no warm-up on mount, so a reader who never opens the panel
  //     never touches ISRO's servers. Nothing here is persisted either — the
  //     opt-in lasts one session, deliberately.
  //  2. A failed fetch must be invisible. The image is preloaded off-DOM and
  //     the `<image>` element is only created once the bytes are in; a 404, a
  //     timeout or a dead service therefore leaves the map exactly as it was,
  //     with no broken-image glyph anywhere.
  const [layersOn, setLayersOn] = useState<Record<string, boolean>>(defaultLayerState);
  const [layerStatus, setLayerStatus] = useState<Record<string, LayerStatus>>({});
  const [overlays, setOverlays] = useState<Record<string, { href: string; rect: ContentRect } | null>>({});
  const layersOnRef = useRef(layersOn); layersOnRef.current = layersOn;
  /** The request key currently placed for each layer: the "nothing changed" test. */
  const placedKey = useRef(new Map<string, string>());
  /** Outcome per request key, so a bbox already tried is not tried again. */
  const requestCache = useRef(new Map<string, "ok" | "error">());
  const inFlight = useRef(new Map<string, HTMLImageElement>());
  const overlayTimer = useRef(0);

  const setStatus = (id: string, next: LayerStatus) =>
    setLayerStatus((prev) => (prev[id] === next ? prev : { ...prev, [id]: next }));

  const remember = (key: string, outcome: "ok" | "error") => {
    const cache = requestCache.current;
    cache.delete(key);
    cache.set(key, outcome);
    // Insertion-ordered Map, so the first key is the least recently written.
    while (cache.size > REQUEST_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  /**
   * Fetch one tile off-DOM. Resolves into `overlays` on success and into a
   * status line on failure; either way the map itself is never disturbed.
   */
  const loadTile = useCallback((layer: MapLayer & { source: { timeoutMs: number } }, req: LayerRequest) => {
    const img = new Image();
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      img.src = "";                       // cancel a transfer still in the air
      inFlight.current.delete(req.key);
      remember(req.key, "error");
      setStatus(layer.id, "unavailable");
    };
    const timer = window.setTimeout(fail, layer.source.timeoutMs);
    img.onerror = fail;
    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      inFlight.current.delete(req.key);
      remember(req.key, "ok");
      // The reader may have switched the layer off while this was in flight.
      if (!layersOnRef.current[layer.id]) return;
      placedKey.current.set(layer.id, req.key);
      setOverlays((prev) => ({ ...prev, [layer.id]: { href: req.url, rect: req.rect } }));
      setStatus(layer.id, "ready");
    };
    inFlight.current.set(req.key, img);
    img.src = req.url;
  }, []);

  const refreshOverlays = useCallback(() => {
    const on = layersOnRef.current;
    const map = mapRef.current;
    if (!map) return;
    const box = map.getBoundingClientRect();
    const viewport = { width: box.width, height: box.height };
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

    for (const layer of MAP_LAYERS) {
      if (!isWms(layer)) continue;
      if (!on[layer.id]) continue;          // rule 1: off means no request, ever

      const req = wmsRequest(layer, FRAME, view.current, viewport, dpr);
      if (!req) {
        // Panned off the layer's coverage. Drop the stale raster rather than
        // leave a tile of India floating over the Bay of Bengal.
        setOverlays((prev) => (prev[layer.id] ? { ...prev, [layer.id]: null } : prev));
        placedKey.current.delete(layer.id);
        setStatus(layer.id, "out-of-view");
        continue;
      }
      if (placedKey.current.get(layer.id) === req.key) continue;
      if (inFlight.current.has(req.key)) continue;
      if (requestCache.current.get(req.key) === "error") { setStatus(layer.id, "unavailable"); continue; }
      setStatus(layer.id, "loading");
      loadTile(layer, req);
    }
  }, [loadTile]);

  /**
   * Debounced: a pinch fires a pointermove per finger per frame, and every one
   * of them changes the bbox. Requests go out once the view has settled.
   */
  const scheduleOverlays = useCallback(() => {
    const on = layersOnRef.current;
    if (!MAP_LAYERS.some((l) => isWms(l) && on[l.id])) return;   // no timer for a layer nobody wants
    window.clearTimeout(overlayTimer.current);
    overlayTimer.current = window.setTimeout(refreshOverlays, REFRESH_DEBOUNCE_MS);
  }, [refreshOverlays]);

  const toggleLayer = useCallback((id: string, next: boolean) => {
    setLayersOn((prev) => ({ ...prev, [id]: next }));
    if (next) return;
    // Switching off drops the raster now, and forgets this layer's failures so
    // that switching it on again genuinely retries a service that may be back.
    setOverlays((prev) => (prev[id] ? { ...prev, [id]: null } : prev));
    placedKey.current.delete(id);
    for (const key of [...requestCache.current.keys()]) {
      if (key.startsWith(`${id}|`)) requestCache.current.delete(key);
    }
    setLayerStatus((prev) => {
      if (!(id in prev)) return prev;
      const next2 = { ...prev }; delete next2[id]; return next2;
    });
  }, []);

  // An explicit opt-in should not wait out the pan debounce.
  useEffect(() => {
    if (!MAP_LAYERS.some((l) => isWms(l) && layersOn[l.id])) return;
    refreshOverlays();
  }, [layersOn, refreshOverlays]);

  // The viewport size feeds the requested pixel size, so a resize re-asks.
  useEffect(() => {
    const onResize = () => scheduleOverlays();
    addEventListener("resize", onResize);
    return () => {
      removeEventListener("resize", onResize);
      window.clearTimeout(overlayTimer.current);
      for (const img of inFlight.current.values()) img.src = "";
      inFlight.current.clear();
    };
  }, [scheduleOverlays]);

  const applyView = () => {
    const { x, y, k } = view.current;
    worldRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
    renderPoints();
    scheduleOverlays();
  };

  /**
   * The only writer of `view`: everything goes through the bounds clamp. The
   * model updates synchronously so the next gesture sample reads the truth,
   * but the paint is coalesced to one per frame — a pinch fires a pointermove
   * per finger and every paint re-attributes every mark on the map.
   */
  const frame = useRef(0);
  const setView = (next: View) => {
    view.current = clampTranslate(next, EXTENT);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; applyView(); });
  };

  // ---- clustering (T-042) -------------------------------------------------
  // Circuit mode suspends the circuit *filter*: tracing dims the rest of the map
  // rather than deleting it, so the route is read in its geographic context.
  const activeFilters = (): Filters =>
    circuitRef.current ? { ...filtersRef.current, cir: "" } : filtersRef.current;

  /** Signature of everything that can change *which* sites are on the map. */
  const dataKey = () => {
    const f = filtersRef.current;
    return [f.q, f.country, f.trad, f.dyn, f.cir, fromRef.current, yearRef.current, circuitRef.current ?? ""].join("|");
  };

  /**
   * Clusters are recomputed only when the answer can have changed: the visible
   * set, or the zoom. Panning cannot change either — cells are keyed to content
   * coordinates (see cluster.ts) — so a drag reuses the cached layout and the
   * clusters simply travel inside the already-transformed world group.
   *
   * Zoom is quantised to ~7% steps so a pinch does not rebuild ~150 DOM nodes on
   * every one of its sixty frames a second. Between steps a glyph is at most 7%
   * off its ideal screen size, which nobody can see mid-pinch, and the gesture's
   * final frame lands on a step and settles.
   */
  function ensureLayout(k: number) {
    const bucket = Math.round(Math.log2(Math.max(k, 1e-6)) * ZOOM_STEPS_PER_OCTAVE);
    const key = `${bucket}|${dataKey()}`;
    if (layout.current.key === key) return layout.current;

    const kq = 2 ** (bucket / ZOOM_STEPS_PER_OCTAVE);
    const f = activeFilters();
    const cir = circuitRef.current;
    let clusters: Cluster[] = [];
    let clustered = new Set<string>();
    if (shouldCluster(kq)) {
      const points: ClusterPoint[] = [];
      for (const s of MAP_SITES) {
        if (!visible(s, f, fromRef.current, yearRef.current)) continue;
        // A numbered stop must stay its own mark: a badge needs something to sit on.
        if (cir && (s.circuits ?? []).includes(cir)) continue;
        points.push({ id: s.id, x: PX(s.lng), y: PY(s.lat), era: eraOf(s), tradition: s.tradition });
      }
      const result = clusterPoints(points, cellSizeFor(kq));
      clusters = [...result.clusters];
      clustered = new Set(result.clustered);
    }
    layout.current = { key, clusters, clustered };
    drawClusters(clusters, kq);
    return layout.current;
  }

  /**
   * A cluster is drawn as a ring of era-proportional arcs (colour keeps meaning
   * era), a row of tradition pips — one per distinct tradition present, in the
   * tradition's own shape (shape keeps meaning tradition) — and the exact count.
   * A mixed cluster therefore shows several pips; it never borrows one shape and
   * implies the group is homogeneous.
   */
  function drawClusters(clusters: readonly Cluster[], k: number) {
    const g = clustersRef.current;
    if (!g) return;
    const active = document.activeElement;
    const restore = active instanceof Element && g.contains(active) ? active.id : null;
    if (!clusters.length) { g.innerHTML = ""; return; }

    const base = Math.max(4.6 / k, 1.6);
    const sw = 1.1 / k;
    const pipR = Math.max(base * 0.4, 0.85);
    let html = "";
    for (const c of clusters) {
      const r = clusterRadius(c.count, base);
      const arcs = donutArcs(c.eras, r)
        .map((a) => `<path fill="none" stroke="var(--e${a.era + 1})" stroke-width="${(sw * 2.8).toFixed(2)}" d="${a.d}"/>`)
        .join("");
      const pipY = (r + pipR * 2.1).toFixed(2);
      const pips = pipOffsets(c.traditions.length, pipR)
        .map((dx, i) => {
          const kind = TRADS[c.traditions[i]] ?? "circle";
          const shape = kind === "circle"
            ? `<circle r="${pipR.toFixed(2)}"/>`
            : `<path d="${shapePath(kind, pipR)}"/>`;
          return `<g transform="translate(${dx} ${pipY})">${shape}</g>`;
        })
        .join("");
      const digits = c.count < 10 ? 1 : c.count < 100 ? 2 : 3;
      const fontSize = r * (digits === 1 ? 1 : digits === 2 ? 0.82 : 0.62);
      html +=
        `<g class="cl" id="${domIdFor({ kind: "cluster", id: c.key })}" tabindex="0" role="button"` +
        ` data-cl="${esc(c.key)}" aria-label="${esc(clusterAriaLabel(c, ERA_NAMES))}"` +
        ` transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})">` +
        `<circle class="cdisc" r="${Math.max(r - sw * 1.4, 0.5).toFixed(2)}" stroke-width="${(sw * 0.9).toFixed(2)}"/>` +
        arcs +
        `<g class="cpips">${pips}</g>` +
        `<text class="cct" font-size="${fontSize.toFixed(2)}" dy="${(fontSize * 0.35).toFixed(2)}">${c.count}</text>` +
        `</g>`;
    }
    g.innerHTML = html;
    if (restore) byDomId(restore)?.focus?.({ preventScroll: true });
  }

  function renderPoints() {
    const k = view.current.k, r = Math.max(4.6 / k, 1.6), sw = 1.1 / k;
    const { clustered } = ensureLayout(k);
    const f = activeFilters();
    const cir = circuitRef.current;
    ptsRef.current?.classList.toggle("tracing", cir !== null);
    clustersRef.current?.classList.toggle("tracing", cir !== null);

    let shown = 0;
    const order: string[] = [];
    for (const s of MAP_SITES) {
      const m = marks.current.get(s.id); if (!m) continue;
      const vis = visible(s, f, fromRef.current, yearRef.current);
      if (vis) shown++;
      const draw = vis && !clustered.has(s.id);
      m.g.style.display = draw ? "" : "none";
      // A numbered stop the year scrub has hidden must not leave its badge floating.
      const badge = cir === null ? undefined : badgeEls.current.get(s.id);
      if (badge) badge.style.display = draw ? "" : "none";
      if (!draw) continue;
      order.push(s.id);
      const builtYet = s.built[0] <= yearRef.current;
      const col = eraColor(eraOf(s));
      if (m.kind === "circle") (m.mark as SVGCircleElement).setAttribute("r", String(r));
      else m.mark.setAttribute("d", shapePath(m.kind, r));
      m.mark.setAttribute("fill", builtYet ? col : "none");
      m.mark.setAttribute("stroke", builtYet ? "var(--bg)" : col);
      m.mark.setAttribute("stroke-width", String(builtYet ? sw : sw * 1.6));
      m.halo.setAttribute("r", String(r * 2.1));
      m.halo.setAttribute("stroke", col);
      m.halo.setAttribute("stroke-width", String(sw * 1.4));
      m.g.classList.toggle("sel", selRef.current === s.id);
      // circuit mode: members carry the route ring, contested claims a dashed one
      const member = cir !== null && (s.circuits ?? []).includes(cir);
      const contested = member && contestsCircuit(s.disputedCircuits, cir as string);
      m.g.classList.toggle("cm", member);
      m.g.classList.toggle("cont", contested);
      m.halo.setAttribute("stroke-dasharray", contested ? `${(sw * 3).toFixed(2)} ${(sw * 2.4).toFixed(2)}` : "");
    }
    markOrder.current = order;

    // circuit badges: built once per circuit at exact site coordinates, then only
    // shifted and resized here, so a pan or a zoom never re-serialises them.
    const badges = badgeRef.current;
    if (badges) {
      badges.setAttribute("transform", `translate(${(r * 1.55).toFixed(2)} ${(-r * 1.35).toFixed(2)})`);
      badges.style.fontSize = `${(r * 2.1).toFixed(2)}px`;
    }
    positionFocusRing(r, sw);
    setShownCount(shown);
  }

  // ---- keyboard navigation (T-043) ---------------------------------------
  // The map is a list of focusable marks in DOM order, and DOM order is the
  // filtered order, so plain Tab already walks the map correctly and not one
  // positive tabindex is needed anywhere. Arrows, Home and End are the fast
  // path over the same order; Enter opens; Escape closes.
  const currentOrder = () => focusOrder(layout.current.clusters.map((c) => c.key), markOrder.current);

  function ringSpot(target: FocusTarget | null, r: number): { x: number; y: number; r: number } | null {
    if (!target) return null;
    if (target.kind === "cluster") {
      const c = layout.current.clusters.find((x) => x.key === target.id);
      return c ? { x: c.x, y: c.y, r: clusterRadius(c.count, r) } : null;
    }
    const s = SITE_BY_ID.get(target.id);
    return s ? { x: PX(s.lng), y: PY(s.lat), r } : null;
  }

  /**
   * One shared focus ring rather than a hidden ring inside each of 1,126 marks.
   * Two concentric circles at the same radius — a wide `--bg` band under a gold
   * one — so the ring reads against land, water and both colour schemes without
   * depending on a filter or a blend mode.
   */
  function positionFocusRing(r: number, sw: number) {
    const g = ringRef.current;
    if (!g) return;
    const spot = ringVisible.current ? ringSpot(focused.current, r) : null;
    if (!spot) { g.style.display = "none"; return; }
    g.style.display = "";
    g.setAttribute("transform", `translate(${spot.x.toFixed(1)} ${spot.y.toFixed(1)})`);
    const radius = (spot.r * 2.7 + sw).toFixed(2);
    const under = g.firstElementChild, over = g.lastElementChild;
    under?.setAttribute("r", radius); under?.setAttribute("stroke-width", (sw * 6).toFixed(2));
    over?.setAttribute("r", radius); over?.setAttribute("stroke-width", (sw * 2.6).toFixed(2));
  }

  function focusTarget(target: FocusTarget) {
    const el = byDomId(domIdFor(target));
    if (!el) return;
    const spot = ringSpot(target, Math.max(4.6 / view.current.k, 1.6));
    if (spot) ensureInView(spot.x, spot.y);
    el.focus?.({ preventScroll: true });
  }

  /** Recentre only when the target is off the stage: arrow keys should not lurch. */
  function ensureInView(x: number, y: number) {
    const { k } = view.current;
    const sx = x * k + view.current.x, sy = y * k + view.current.y;
    const pad = 48;
    if (sx > pad && sx < W - pad && sy > pad && sy < H - pad) return;
    setView({ k, x: W / 2 - x * k, y: H / 2 - y * k });
  }

  function activate(target: FocusTarget) {
    if (target.kind === "mark") { returnTo.current = domIdFor(target); select(target.id, false, true); return; }
    const c = layout.current.clusters.find((x) => x.key === target.id);
    if (!c) return;
    setView(viewForBounds(c.bounds, EXTENT));
    // The cluster is about to dissolve; hand focus to the member it opened onto,
    // and fall back to the map itself so focus is never dropped on the body.
    const first = c.ids[0];
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = byDomId(domIdFor({ kind: "mark", id: first }));
      (el ?? mapRef.current)?.focus?.({ preventScroll: true });
    }));
  }

  /** Escape ladder: site, then index or circuit list, then circuit mode. */
  const dismiss = useCallback(() => {
    if (selRef.current) {
      select(null, false);
      const back = returnTo.current;
      if (back) byDomId(back)?.focus?.({ preventScroll: true });
      return true;
    }
    if (index) { setIndex(false); return true; }
    if (circuitRef.current) { setCircuit(null); return true; }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const onMapKeyDown = (e: React.KeyboardEvent) => {
    const intent = keyIntent(e);
    if (!intent) return;
    if (intent === "dismiss") { if (dismiss()) e.preventDefault(); return; }
    const target = e.target instanceof Element ? targetFromDomId(e.target.id) : null;
    if (intent === "activate") {
      if (!target) return;
      e.preventDefault();
      activate(target);
      return;
    }
    const next = resolveMove(currentOrder(), target, intent);
    if (!next) return;
    e.preventDefault();
    focusTarget(next);
  };

  // build points once
  useEffect(() => {
    const ptsG = ptsRef.current!; ptsG.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    for (const s of MAP_SITES) {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "pt");
      // Focusable, named, and in filtered DOM order: the whole of T-043's
      // traversal contract lives in these three attributes.
      g.setAttribute("id", domIdFor({ kind: "mark", id: s.id }));
      // Read back on pointerup to resolve a tap — see the note on `tap` below:
      // pointer capture stops the click listener firing on touch devices.
      g.setAttribute("data-site", s.id);
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", `${s.name} — ${s.place}, ${s.country}. ${s.builtDisplay}. ${s.tradition}.`);
      g.setAttribute("transform", `translate(${PX(s.lng).toFixed(1)} ${PY(s.lat).toFixed(1)})`);
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("class", "halo"); halo.setAttribute("fill", "none");
      const kind = TRADS[s.tradition] ?? "circle";
      const mark = document.createElementNS(NS, kind === "circle" ? "circle" : "path");
      g.appendChild(halo); g.appendChild(mark);
      // Kept for mouse and for synthetic clicks from keyboard activation. The
      // pointerup path handles touch, where this never fires; `selRef` guards
      // the overlap so a mouse click does not select twice.
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (selRef.current === s.id) return;
        returnTo.current = g.id;
        select(s.id, false);
      });
      g.addEventListener("mouseenter", (e) => showTip(s, e as MouseEvent));
      g.addEventListener("mousemove", (e) => moveTip(e as MouseEvent));
      g.addEventListener("mouseleave", hideTip);
      ptsG.appendChild(g);
      marks.current.set(s.id, { g, mark, halo, kind });
    }
    renderPoints();
    // opening sweep
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      let y = YEAR_MIN;
      const t = setTimeout(() => {
        setRange([YEAR_MIN, YEAR_MIN]);
        const iv = setInterval(() => { y += 28; if (y >= YEAR_MAX) { y = YEAR_MAX; clearInterval(iv); } setYear(y); }, 26);
      }, 450);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { renderPoints(); drawTimeline(); }, [filters, from, year, sel, circuit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- gestures: pan, pinch zoom, double tap, wheel ----------------------
  // One Pointer Events pipeline drives all of them. Every pointer that is down
  // lives in `pointers`, and its *count* picks the mode — so one finger pans,
  // two pinch, and neither can fight the other. Anything that removes a pointer
  // (up, cancel, one finger lifting out of a pinch) re-bases the gesture from
  // what is left, which is what stops an interrupted gesture leaving the map
  // stuck or lurching. `touch-action:none` on svg.map keeps the browser from
  // claiming the gesture and page-zooming instead.
  useEffect(() => {
    const map = mapRef.current!;
    const stageOf = (client: Point): Point => toStagePoint(client, map.getBoundingClientRect(), EXTENT);
    const pxToStage = () => viewportScale(EXTENT, map.getBoundingClientRect());
    const zoomAt = (px: number, py: number, f: number) => setView(scaleAbout(view.current, { x: px, y: py }, f));
    (map as unknown as { _zoomAt: typeof zoomAt })._zoomAt = zoomAt;

    // A trackpad pinch reaches the page as a wheel event with ctrlKey set;
    // both it and a real wheel anchor on the cursor.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const anchor = stageOf({ x: e.clientX, y: e.clientY });
      zoomAt(anchor.x, anchor.y, wheelZoomFactor(e.deltaY, e.ctrlKey));
    };

    const pointers = new Map<number, Point>();
    let pan: { id: number; from: Point; base: View } | null = null;
    let spread = 0;                     // finger distance at the last pinch sample
    let pinchMid: Point | null = null;  // client midpoint at the last pinch sample
    // The element the tap started on, not just whether it was background.
    // `click` cannot be trusted here: the map takes pointer capture on every
    // pointerdown, and the browser retargets the synthesised click to the
    // capture element — so a listener on a mark or a cluster never fires. Taps
    // are therefore resolved from the pointerdown target on pointerup.
    let tap: { id: number; hit: Element | null; onBackground: boolean } | null = null;
    let lastTap: Tap | null = null;

    // Re-derive the gesture from whatever is still down. Called after every
    // add or remove, so mode switches start from the current view and never jump.
    const resync = () => {
      const active = [...pointers.values()];
      if (active.length > 1) {
        pan = null;
        spread = distance(active[0], active[1]);
        pinchMid = midpoint(active[0], active[1]);
        map.classList.remove("drag");
        return;
      }
      spread = 0; pinchMid = null;
      const [id] = [...pointers.keys()];
      pan = active.length === 1 ? { id, from: active[0], base: view.current } : null;
      map.classList.toggle("drag", pan !== null);
    };

    const forget = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return false;
      // pointercancel has already released it for us; releasing twice throws.
      if (map.hasPointerCapture(e.pointerId)) map.releasePointerCapture(e.pointerId);
      return true;
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { map.setPointerCapture(e.pointerId); } catch { /* pointer already gone; the Map still tracks it */ }
      // A second finger cancels any tap in flight: this is a pinch, not a tap.
      const hit = e.target instanceof Element ? e.target.closest(".pt,.cl") : null;
      tap = pointers.size === 1 ? { id: e.pointerId, hit, onBackground: !hit } : null;
      if (pointers.size > 1) { lastTap = null; hideTip(); }
      resync();
    };

    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const active = [...pointers.values()];
      if (active.length > 1) {
        const [a, b] = active;
        const mid = midpoint(a, b), gap = distance(a, b), scale = pxToStage();
        // Follow the midpoint, then scale about it: the map zooms toward the
        // fingers rather than toward the centre of the viewBox.
        const followed = pinchMid
          ? translateBy(view.current, (mid.x - pinchMid.x) * scale, (mid.y - pinchMid.y) * scale)
          : view.current;
        setView(scaleAbout(followed, stageOf(mid), pinchFactor(spread, gap)));
        spread = gap; pinchMid = mid;
        return;
      }
      if (!pan || pan.id !== e.pointerId) return;
      if (tap && distance(pan.from, { x: e.clientX, y: e.clientY }) > TAP_SLOP_PX) tap = null;
      const scale = pxToStage();
      setView(translateBy(pan.base, (e.clientX - pan.from.x) * scale, (e.clientY - pan.from.y) * scale));
    };

    const up = (e: PointerEvent) => {
      if (!forget(e)) return;
      const candidate = tap?.id === e.pointerId ? tap : null;
      tap = null;
      resync();
      if (!candidate) return;   // ended a drag or a pinch, not a tap
      const now: Tap = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      if (isDoubleTap(lastTap, now)) {
        lastTap = null;
        const anchor = stageOf(now);
        zoomAt(anchor.x, anchor.y, DOUBLE_TAP_ZOOM);
        return;
      }
      lastTap = now;

      if (candidate.onBackground) { select(null, false); return; }

      // Resolve the hit here rather than relying on a click listener that
      // pointer capture prevents from firing.
      const hit = candidate.hit;
      if (hit?.classList.contains("cl")) {
        const key = hit.getAttribute("data-cl");
        const c = key ? layout.current.clusters.find((cl) => cl.key === key) : null;
        if (c) { hideTip(); setView(viewForBounds(c.bounds, EXTENT)); }
        return;
      }
      if (hit?.classList.contains("pt")) {
        const id = hit.getAttribute("data-site");
        if (id) { returnTo.current = hit.id || null; select(id, false); }
      }
    };

    // A call or notification mid-gesture: drop everything and re-derive.
    const cancel = (e: PointerEvent) => {
      if (!forget(e)) return;
      tap = null; lastTap = null;
      resync();
    };

    map.addEventListener("wheel", onWheel, { passive: false });
    map.addEventListener("pointerdown", down);
    map.addEventListener("pointermove", move);
    map.addEventListener("pointerup", up);
    map.addEventListener("pointercancel", cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      map.removeEventListener("wheel", onWheel);
      map.removeEventListener("pointerdown", down);
      map.removeEventListener("pointermove", move);
      map.removeEventListener("pointerup", up);
      map.removeEventListener("pointercancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clicking a cluster zooms to its bounds; hovering one explains its mix.
  useEffect(() => {
    const g = clustersRef.current!;
    const clusterOf = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest(".cl") : null;
      const key = el?.getAttribute("data-cl");
      return key ? layout.current.clusters.find((c) => c.key === key) ?? null : null;
    };
    const onClick = (e: MouseEvent) => {
      const c = clusterOf(e.target);
      if (!c) return;
      e.stopPropagation();
      hideTip();
      setView(viewForBounds(c.bounds, EXTENT));
    };
    const onOver = (e: MouseEvent) => { const c = clusterOf(e.target); if (c) showClusterTip(c, e); };
    const onMove = (e: MouseEvent) => { if (clusterOf(e.target)) moveTip(e); };
    g.addEventListener("click", onClick);
    g.addEventListener("mouseover", onOver);
    g.addEventListener("mousemove", onMove);
    g.addEventListener("mouseout", hideTip);
    return () => {
      g.removeEventListener("click", onClick);
      g.removeEventListener("mouseover", onOver);
      g.removeEventListener("mousemove", onMove);
      g.removeEventListener("mouseout", hideTip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track which mark or cluster holds focus, and whether it was reached by
  // keyboard: a mouse click must not paint a focus ring on the map.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const repaint = () => {
      const k = view.current.k;
      positionFocusRing(Math.max(4.6 / k, 1.6), 1.1 / k);
    };
    const onIn = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const target = targetFromDomId(el?.id);
      focused.current = target;
      let keyboard = target !== null;
      try { keyboard = keyboard && !!el?.matches(":focus-visible"); } catch { /* older engine: assume keyboard */ }
      ringVisible.current = keyboard;
      if (target && keyboard && el) showTipFor(target, el);
      repaint();
    };
    const onOut = () => { focused.current = null; ringVisible.current = false; hideTip(); repaint(); };
    wrap.addEventListener("focusin", onIn);
    wrap.addEventListener("focusout", onOut);
    return () => { wrap.removeEventListener("focusin", onIn); wrap.removeEventListener("focusout", onOut); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomCenter = (f: number) => (mapRef.current as unknown as { _zoomAt: (x: number, y: number, f: number) => void })._zoomAt(W / 2, H / 2, f);
  const resetView = () => setView({ x: 0, y: 0, k: 1 });
  const flyTo = (s: MapSite) => { const k = Math.max(view.current.k, 4.5); setView({ k, x: W / 2 - PX(s.lng) * k, y: H * 0.42 - PY(s.lat) * k }); };

  function select(id: string | null, fly = true, focusPanel = false) {
    setSel(id); setIndex(false);
    if (id) { const s = SITE_BY_ID.get(id); if (s && fly) flyTo(s); }
    if (focusPanel) requestAnimationFrame(() => sideRef.current?.focus({ preventScroll: true }));
    // shareable deep link: /#site=<id>
    try { history.replaceState(null, "", id ? `#site=${id}` : window.location.pathname); } catch { /* no-op */ }
  }

  // open a site from the URL hash on load (e.g. /#site=angkor-wat)
  useEffect(() => {
    const m = window.location.hash.match(/^#site=([a-z0-9-]+)$/);
    if (m && SITE_BY_ID.has(m[1])) {
      const t = setTimeout(() => select(m[1], true), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- circuit mode (T-046) ----------------------------------------------
  const route: CircuitRoute | null = useMemo(() => {
    if (!circuit) return null;
    return circuitRoute(
      MAP_SITES.filter((s) => (s.circuits ?? []).includes(circuit)).map((s) => ({
        id: s.id, name: s.name, lat: s.lat, lng: s.lng,
        contested: contestsCircuit(s.disputedCircuits, circuit),
      })),
    );
  }, [circuit]);

  useEffect(() => {
    const g = badgeRef.current;
    if (!g) return;
    if (!route) { g.innerHTML = ""; badgeEls.current = new Map(); return; }
    g.innerHTML = [...route.stops, ...route.contested]
      .map((stop) => {
        const s = SITE_BY_ID.get(stop.id);
        if (!s) return "";
        const cls = stop.ordinal === null ? "cbadge cont" : "cbadge";
        return `<text class="${cls}" data-site="${esc(stop.id)}" x="${PX(s.lng).toFixed(1)}" y="${PY(s.lat).toFixed(1)}">${esc(badgeFor(stop))}</text>`;
      })
      .join("");
    const els = new Map<string, SVGTextElement>();
    for (const el of Array.from(g.querySelectorAll<SVGTextElement>("text[data-site]"))) {
      const id = el.getAttribute("data-site");
      if (id) els.set(id, el);
    }
    badgeEls.current = els;
    renderPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const toggleTrace = () => {
    if (circuit) { setCircuit(null); return; }
    if (!filters.cir) return;
    setSel(null); setIndex(false); setCircuit(filters.cir);
  };

  // ---- bottom sheet (T-041) ----------------------------------------------
  useEffect(() => {
    const mq = matchMedia(SHEET_QUERY);
    const sync = () => setIsSheet(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const panelOpen = sel !== null || index || circuit !== null;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (panelOpen && !wasOpen.current) setSnap("half");  // a fresh open starts half way
    wasOpen.current = panelOpen;
  }, [panelOpen]);

  const closePanel = useCallback(() => {
    setSel(null); setIndex(false); setCircuit(null);
    try { history.replaceState(null, "", window.location.pathname); } catch { /* no-op */ }
  }, []);

  /**
   * Sheet drag. Deliberately bound to the grab bar alone and not to the sheet
   * body: the map captures its pointers on the `svg` itself, so a gesture that
   * begins on this element can never reach the map's pipeline, and the sheet's
   * own content keeps native scrolling. The bar carries `touch-action:none` so
   * the browser does not claim the drag first.
   */
  const drag = useRef<
    { id: number; y0: number; base: number; height: number; last: number; at: number; velocity: number }
    | null
  >(null);

  const onGrabDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSheet || !panelOpen) return;
    const el = sideRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId, y0: e.clientY, base: SNAPS[snap],
      height: el.offsetHeight || 1, last: SNAPS[snap], at: e.timeStamp, velocity: 0,
    };
    setDragging(true);
  };

  const onGrabMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !sideRef.current) return;
    const pct = Math.min(100, Math.max(SNAPS.full, d.base + ((e.clientY - d.y0) / d.height) * 100));
    d.velocity = (pct - d.last) / Math.max(e.timeStamp - d.at, 1);
    d.last = pct; d.at = e.timeStamp;
    sideRef.current.style.transform = `translateY(${pct}%)`;
  };

  const onGrabUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (sideRef.current) sideRef.current.style.transform = "";
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.last > SHEET_DISMISS_PCT || d.velocity > SHEET_FLICK_PCT_PER_MS) { closePanel(); return; }
    setSnap(nearestSnap(d.last));
  };

  const onGrabKeyDown = (e: React.KeyboardEvent) => {
    const at = SNAP_ORDER.indexOf(snap);
    if (e.key === "ArrowUp" && at > 0) { e.preventDefault(); setSnap(SNAP_ORDER[at - 1]); }
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (at < SNAP_ORDER.length - 1) setSnap(SNAP_ORDER[at + 1]); else closePanel();
    }
  };

  // ---- coach mark (T-049) -------------------------------------------------
  useEffect(() => {
    if (readFlag(COACH_KEY) === "seen") return;
    const t = setTimeout(() => setCoach(true), COACH_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  const dismissCoach = useCallback(() => { setCoach(false); writeFlag(COACH_KEY, "seen"); }, []);

  // tooltip
  function showTip(s: MapSite, e: MouseEvent) {
    const tip = tipRef.current!;
    tip.innerHTML = `<div class="tn">${esc(s.name)}</div><div class="tm">${esc(s.place)} · ${esc(s.country)}</div><div class="ty" style="color:${eraColor(eraOf(s))}">${esc(s.builtDisplay)}</div>`;
    tip.style.opacity = "1"; moveTip(e);
  }
  function showClusterTip(c: Cluster, e: MouseEvent) {
    const tip = tipRef.current!;
    const eras = c.eras.map((x) => `${x.count} ${ERA_NAMES[x.era] ?? ""}`).join(" · ");
    tip.innerHTML = `<div class="tn">${c.count} sites</div><div class="tm">${esc(c.traditions.join(" · "))}</div><div class="ty">${esc(eras)}</div>`;
    tip.style.opacity = "1"; moveTip(e);
  }
  /** Keyboard focus gets the same tooltip, anchored on the element, not a cursor. */
  function showTipFor(target: FocusTarget, el: Element) {
    const box = el.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 } as MouseEvent;
    if (target.kind === "cluster") {
      const c = layout.current.clusters.find((x) => x.key === target.id);
      if (c) showClusterTip(c, at);
      return;
    }
    const s = SITE_BY_ID.get(target.id);
    if (s) showTip(s, at);
  }
  function moveTip(e: MouseEvent) {
    const tip = tipRef.current!, r = wrapRef.current!.getBoundingClientRect();
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 10;
    if (x > r.width - 250) x -= 270; if (y > r.height - 90) y -= 80;
    tip.style.left = `${Math.max(4, x)}px`; tip.style.top = `${Math.max(4, y)}px`;
  }
  function hideTip() { if (tipRef.current) tipRef.current.style.opacity = "0"; }

  // timeline
  function drawTimeline() {
    const svg = tlRef.current; if (!svg) return;
    const w = svg.getBoundingClientRect().width || 800, h = 64;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const x = (y: number) => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * w;
    const BIN = 50; const bins: Record<number, number> = {};
    for (const s of MAP_SITES) { const b = Math.floor(s.built[0] / BIN) * BIN; bins[b] = (bins[b] ?? 0) + 1; }
    const max = Math.max(...Object.values(bins));
    let bars = "";
    for (const [bs, n] of Object.entries(bins)) {
      const b = +bs; const bh = Math.max(2, (n / max) * 34);
      bars += `<rect x="${x(b) + 0.5}" y="${44 - bh}" width="${Math.max(2, x(b + BIN) - x(b) - 1.5)}" height="${bh}" rx="1.5" fill="var(--e${eraOf({ built: [b + BIN / 2, 0] }) + 1})" opacity="${b + BIN / 2 <= yearRef.current ? 1 : 0.22}"/>`;
    }
    let bands = "", labels = ""; let prev = YEAR_MIN;
    ERAS.forEach((e, i) => {
      const to = Math.min(e.to, YEAR_MAX);
      bands += `<rect x="${x(prev)}" y="46" width="${x(to) - x(prev)}" height="6" fill="var(--e${i + 1})" opacity=".55" rx="1"/>`;
      if (x(to) - x(prev) > 70) labels += `<text x="${(x(prev) + x(to)) / 2}" y="61" text-anchor="middle" font-size="8.5" letter-spacing="1.5" fill="var(--mut)" style="font-family:var(--font-mono),monospace">${e.name.toUpperCase()}</text>`;
      prev = to;
    });
    const cx = x(Math.min(yearRef.current, YEAR_MAX));
    // Thin the axis by available width. The full set collides on a phone: at
    // 390px "500BCE" ends at x=193 and "1CE" starts at x=191, a 2px overlap.
    // 1CE drops first — it sits between 500BCE and 500, which already bracket it.
    const axisWidth = svg.clientWidth || svg.getBoundingClientRect().width || 0;
    const tickYears =
      axisWidth < 420 ? [-500, 500, 1000, 1500, 2000]
      : [-500, 1, 500, 1000, 1500, 2000];
    const ticks = tickYears.map((t) => `<text x="${x(t)}" y="9" text-anchor="middle" font-size="8" fill="var(--mut)" style="font-family:var(--font-mono),monospace">${t < 0 ? `${Math.abs(t)}BCE` : t === 1 ? "1CE" : t}</text>`).join("");
    svg.innerHTML = `${ticks}${bars}${bands}${labels}<line x1="${cx}" y1="4" x2="${cx}" y2="52" stroke="var(--gold)" stroke-width="1.2"/>`;
  }
  useEffect(() => {
    const onR = () => drawTimeline();
    addEventListener("resize", onR); return () => removeEventListener("resize", onR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // play
  useEffect(() => {
    if (!playing) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setYear(YEAR_MAX); setPlaying(false); return; }
    if (yearRef.current >= YEAR_MAX) setYear(fromRef.current);
    const iv = setInterval(() => {
      setYear((y) => { const n = y + 12; if (n >= YEAR_MAX) { clearInterval(iv); setPlaying(false); return YEAR_MAX; } return n; });
    }, 40);
    return () => clearInterval(iv);
  }, [playing]);

  const selected = sel ? SITE_BY_ID.get(sel) ?? null : null;

  /**
   * The selected record's prose, fetched on selection rather than bundled.
   *
   * `null` while it is in flight, so the rail renders its header, chips, dates
   * and coordinates immediately from the map index and fills the prose in when
   * it lands. That ordering is deliberate: everything above the fold is already
   * in memory, so the panel never shows a spinner where a name should be.
   */
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    const controller = new AbortController();
    setDetail(null);
    loadRecord(sel, controller.signal).then((d) => { if (!controller.signal.aborted) setDetail(d); });
    // Abort on a fast re-select so a slow fetch cannot land after a newer one
    // and paint the previous temple's history under the current temple's name.
    return () => controller.abort();
  }, [sel]);
  const spanAll = from === YEAR_MIN && year >= YEAR_MAX;
  const visList = MAP_SITES.filter((s) => visible(s, filters, from, year));
  // Asked only when the bundled index has already come back empty.
  const spellingHelp = useSpellingHelp(filters.q, visList.length);
  const shapes: Record<string, string> = {
    circle: '<circle cx="5.5" cy="5.5" r="4.6"/>', square: '<rect x="1.4" y="1.4" width="8.2" height="8.2"/>',
    diamond: '<path d="M5.5 0L11 5.5L5.5 11L0 5.5Z"/>', triangle: '<path d="M5.5 0.4L10.8 10.2H0.2Z"/>',
  };
  const disputesFor = (s: MapSite, c: string) => (s.disputedCircuits ?? []).filter((d) => d.circuit === c);
  const sideClass = ["side", panelOpen ? "open" : "", isSheet ? `sheet snap-${snap}` : "", dragging ? "dragging" : ""]
    .filter(Boolean).join(" ");

  return (
    <>
      <SiteHeader stats={STATS} indexOpen={index} onIndexToggle={toggleIndex} />

      <div className="filters">
        <input type="search" placeholder="Search temples, deities, places…" aria-label="Search" value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <button className={`ftoggle ${fOpen ? "on" : ""}`} onClick={() => setFOpen(!fOpen)} aria-expanded={fOpen} aria-controls="fwrap">
          Filters{(filters.country || filters.trad || filters.dyn || filters.cir) ? " ·" : ""} {fOpen ? "▴" : "▾"}
        </button>
        <div className={`fwrap ${fOpen ? "open" : ""}`} id="fwrap">
          <select aria-label="Country" value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value })}>
            <option value="">All countries</option>{lists.countries.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Tradition" value={filters.trad} onChange={(e) => setFilters({ ...filters, trad: e.target.value })}>
            <option value="">All traditions</option>{lists.trads.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Dynasty" value={filters.dyn} onChange={(e) => setFilters({ ...filters, dyn: e.target.value })}>
            <option value="">All dynasties</option>{lists.dyns.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Circuit" value={filters.cir} onChange={(e) => setFilters({ ...filters, cir: e.target.value })}>
            <option value="">All circuits</option>{lists.cirs.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className={`tracebtn ${circuit ? "on" : ""}`} onClick={toggleTrace} aria-pressed={circuit !== null}
            disabled={!circuit && !filters.cir}
            title={circuit ? "Leave circuit mode" : "Number and highlight the selected circuit on the map"}>
            {circuit ? "Exit circuit" : "Trace circuit"}
          </button>
          <button className="reset" onClick={() => { setFilters(EMPTY); setCircuit(null); }}>reset</button>
        </div>
        <span className="count"><b>{shownCount}</b> of {MAP_SITES.length} sites shown</span>
        {spellingHelp.length > 0 && (
          /* Suggestions, not results. The local index found nothing, so these
             come from Postgres, where the name is matched on a transliteration-
             normalised form. Offered beside the count rather than merged into
             it, because a fuzzy hit is not the same claim as a match. */
          <div className="didyoumean" role="status">
            <span>Did you mean</span>
            {spellingHelp.map((s) => (
              <button key={s.id} type="button" onClick={() => { setFilters((f) => ({ ...f, q: s.name })); select(s.id, true); }}>
                {s.name}
                <em>{s.place}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="main">
        {/* Builtin layers are switched by class, not by re-serialising geo.json. */}
        <div className={`mapwrap ${builtinOffClasses(layersOn)}`.trimEnd()} ref={wrapRef} onKeyDown={onMapKeyDown}>
          {/* role="group", not role="img": role="img" makes the whole subtree
              presentational, which would hide every focusable mark from assistive
              technology and undo T-043. The boundary statement stays the label. */}
          <svg ref={mapRef} className="map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="group"
            tabIndex={-1}
            aria-label="Map of South and Southeast Asia with sacred sites (boundaries as per Government of India). Use Tab or the arrow keys to move between marks, Enter to open one, Escape to close.">
            <g ref={worldRef}>
              {/* Static country outlines, rendered by the SERVER (page.tsx) and
                  handed down as markup. 385 kB of SVG that never changes between
                  deploys and that nothing interactive reads — shipping it as a
                  JS module cost 136.7 kB gzipped on every homepage load. */}
              <g dangerouslySetInnerHTML={{ __html: outlines }} />
              {/* Remote layers sit above the land fill and below every mark, so a
                  boundary never covers a site. An <image> exists only once its
                  bytes have already loaded off-DOM — that is what makes a dead
                  service invisible rather than a row of broken-image glyphs. */}
              <g className="wmslayers" aria-hidden="true">
                {MAP_LAYERS.filter(isWms).map((layer) => {
                  const placed = layersOn[layer.id] ? overlays[layer.id] : null;
                  if (!placed) return null;
                  return (
                    <image
                      key={layer.id}
                      className={`wmslayer wl-${layer.id}`}
                      href={placed.href}
                      x={placed.rect.x}
                      y={placed.rect.y}
                      width={placed.rect.width}
                      height={placed.rect.height}
                      preserveAspectRatio="none"
                      onError={() => setOverlays((prev) => ({ ...prev, [layer.id]: null }))}
                    />
                  );
                })}
              </g>
              {/* clusters precede marks so the tab order meets the aggregate first */}
              <g ref={clustersRef} className="clusters" />
              <g ref={ptsRef} className="pts" />
              <g ref={badgeRef} className="cbadges" aria-hidden="true" />
              <g ref={ringRef} className="focusring" aria-hidden="true" style={{ display: "none" }}>
                <circle className="fr-u" fill="none" />
                <circle className="fr" fill="none" />
              </g>
            </g>
          </svg>
          <LayerControl on={layersOn} onToggle={toggleLayer} status={layerStatus} />
          <div className="maptools">
            <button aria-label="Zoom in" onClick={() => zoomCenter(1.5)}>+</button>
            <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.5)}>−</button>
            <button aria-label="Reset view" style={{ fontSize: 12 }} onClick={resetView}>⌂</button>
          </div>
          <div className="maplegend">
            {ERAS.map((e, i) => <span className="li" key={e.name}><span className="dot" style={{ background: `var(--e${i + 1})` }} />{e.name}</span>)}
            <span className="li" style={{ opacity: 0.8 }}>○ sacred, pre-structure</span>
          </div>
          <div className="tip" ref={tipRef} role="status" />
        </div>

        <aside
          ref={sideRef}
          className={sideClass}
          tabIndex={-1}
          aria-label={selected ? selected.name : circuit ? `${circuit} circuit` : index ? "Gazetteer index" : "About the atlas"}
          onKeyDown={(e) => { if (keyIntent(e) === "dismiss" && dismiss()) e.preventDefault(); }}
        >
          {/* One sticky header holds both, so the sheet's controls stay put while
              its content scrolls. Neither exists above the sheet breakpoint. */}
          <div className="sheethead">
            <div className="sheetgrab" role="slider" tabIndex={isSheet && panelOpen ? 0 : -1}
              aria-label="Panel height" aria-valuemin={0} aria-valuemax={SNAP_ORDER.length - 1}
              aria-valuenow={SNAP_ORDER.length - 1 - SNAP_ORDER.indexOf(snap)} aria-valuetext={snap}
              onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp}
              onPointerCancel={onGrabUp} onKeyDown={onGrabKeyDown}>
              <span className="grabline" />
            </div>
            <button className="sheetclose" onClick={closePanel} aria-label="Close panel">×</button>
          </div>

          {selected ? (
            <div className="pan">
              <button className="crumb" onClick={() => select(null, false)}>
                ← {circuit ? `back to ${circuit}` : "all sites"}
              </button>
              <div className="eyebrow" style={{ color: eraColor(eraOf(selected)) }}>{ERAS[eraOf(selected)].name} · {selected.country}</div>
              <h2 className="site">{selected.name}</h2>
              {selected.native && <div className="native">{selected.native}</div>}
              <div className="where">{selected.place}{selected.state ? `, ${selected.state}` : ""} · <span className="mono" style={{ fontSize: 11 }}>{selected.lat.toFixed(4)}°, {selected.lng.toFixed(4)}°</span></div>
              <div className="chips">
                {[selected.tradition, selected.dynasty, selected.style].map((c) => <span className="chip" key={c}>{c}</span>)}
                {(selected.circuits ?? []).map((c) => <span className="chip gold" key={c}>{c}</span>)}
              </div>
              <div className="dates">
                <div><div className="dl">Sacred since</div><div className="dv">{fmtYear(appearYear({ ...selected, origin: detail?.origin }))}</div><div className="ds">{detail?.originNote ?? "first attestation / structure"}</div></div>
                <div><div className="dl">Standing structure</div><div className="dv">{selected.builtDisplay}</div><div className="ds">{detail?.patron ? `patron: ${detail.patron}` : selected.dynasty}</div></div>
              </div>
              <div className="sect"><h3>Deity & significance</h3><p><b>{selected.deity}.</b> {detail?.significance ?? ""}</p></div>
              {detail?.story && (
                /* CLAUDE.md rule 3 is the project's second-most-important
                   guarantee, and its whole visual expression used to be
                   `font-style: italic` plus a lighter colour — invisible to a
                   screen reader and ambiguous to everyone else. A real
                   <section> with an accessible name states the distinction in
                   the DOM, and the framing line states it in words, so it
                   survives both assistive technology and CSS being removed. */
                <section className="sect katha" aria-label="Sthala katha — traditional account, not documented history">
                  <h3>Sthala katha · traditional account</h3>
                  <p className="kathaframe">{KATHA_FRAMING}</p>
                  <p>{detail.story}</p>
                </section>
              )}
              {detail?.access && <div className="sect"><h3>Reaching there</h3><p className="practical">{detail.access}</p></div>}
              <div className="actions">
                <Link className="primary" href={`/site/${selected.id}`}>Full entry →</Link>
                {detail?.website && <a href={detail.website} target="_blank" rel="noopener noreferrer">Official site ↗</a>}
                <a href={gmapsUrl(selected)} target="_blank" rel="noopener noreferrer">Google Maps ↗</a>
                {detail?.wiki && <a href={detail.wiki} target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>}
              </div>
              {detail?.phone && <p className="practical mono" style={{ marginTop: 6 }}>☏ {detail.phone}</p>}
              <div className="srcs">
                <h3 style={{ fontFamily: "var(--font-mono),monospace", fontSize: 10, letterSpacing: ".18em", color: "var(--mut)", textTransform: "uppercase", marginBottom: 2 }}>Sources</h3>
                <ul>{(detail?.sources ?? []).map((x) => <li key={x.u}><a href={x.u} target="_blank" rel="noopener noreferrer">{x.l}</a></li>)}</ul>
                {/* The stamp is a METHOD and a date, not a human verification:
                    2,102 of 3,031 records share one timestamp because one script
                    checked them in an afternoon. readVerification says so plainly
                    and never emits the word "verified" for an automated check. */}
                <div className="vnote">{readVerification(detail?.verified).label}</div>
              </div>
            </div>
          ) : circuit && route ? (
            <div className="pan cir">
              <button className="crumb" onClick={() => setCircuit(null)}>← leave circuit mode</button>
              <div className="eyebrow">Circuit</div>
              <h2 className="site" style={{ fontSize: 21 }}>{circuit}</h2>
              <p className="lead">
                {route.stops.length} numbered {route.stops.length === 1 ? "stop" : "stops"}
                {route.contested.length > 0 ? ` · ${route.contested.length} contested ${route.contested.length === 1 ? "claim" : "claims"}` : ""}
              </p>
              <p className="ordernote">{CIRCUIT_ORDER_NOTE}</p>
              <ol className="cirlist">
                {route.stops.map((stop) => {
                  const s = SITE_BY_ID.get(stop.id);
                  if (!s) return null;
                  return (
                    <li key={stop.id}>
                      <button className="cirrow" onClick={() => { returnTo.current = domIdFor({ kind: "mark", id: stop.id }); select(stop.id); }}>
                        <span className="ord" style={{ borderColor: eraColor(eraOf(s)) }}>{stop.ordinal}</span>
                        <span className="nm">{s.name}</span>
                        <span className="yr">{s.place}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {route.contested.length > 0 && (
                <div className="sect">
                  <h3>Contested claims</h3>
                  <p className="practical">
                    These records claim {circuit} and carry their own cited note contesting the claim. They are drawn
                    with {CONTESTED_BADGE} and a dashed ring, and are deliberately left unnumbered: numbering one
                    would assert a slot that rival shrines dispute.
                  </p>
                  <ol className="cirlist contested">
                    {route.contested.map((stop) => {
                      const s = SITE_BY_ID.get(stop.id);
                      if (!s) return null;
                      return (
                        <li key={stop.id}>
                          <button className="cirrow" onClick={() => { returnTo.current = domIdFor({ kind: "mark", id: stop.id }); select(stop.id); }}>
                            <span className="ord cont">{CONTESTED_BADGE}</span>
                            <span className="nm">{s.name}</span>
                            <span className="yr">{s.place}</span>
                          </button>
                          {disputesFor(s, circuit).map((d) => (
                            <p className="disputenote" key={d.note}>
                              {d.note}{" "}
                              {d.source && <a href={d.source} target="_blank" rel="noopener noreferrer">source ↗</a>}
                            </p>
                          ))}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </div>
          ) : index ? (
            <div className="pan ix">
              <div className="eyebrow">Index</div>
              <h2 className="site" style={{ fontSize: 21 }}>Gazetteer — {visList.length} sites</h2>
              {[...new Set(visList.map((s) => s.country))].sort().map((c) => (
                <div key={c}>
                  <h4>{c} · {visList.filter((s) => s.country === c).length}</h4>
                  {visList.filter((s) => s.country === c).sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                    <button className="ixrow" key={s.id}
                      onClick={() => { returnTo.current = domIdFor({ kind: "mark", id: s.id }); select(s.id); }}>
                      <span className="d" style={{ background: eraColor(eraOf(s)) }} />
                      <span className="nm">{s.name}</span>
                      <span className="yr">{fmtYear(s.built[0])}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="pan ov">
              <div className="eyebrow">The Atlas</div>
              <h2 className="site" style={{ fontSize: 21 }}>Twenty-six centuries of sacred building</h2>
              <p className="lead">Scrub the timeline to watch temples rise from Mauryan stupas to the newest mandirs — or click any mark for history, legend, pilgrim routes, and full citations. Colour is the era of the standing structure; shape is the tradition.</p>
              <div className="statgrid">
                <div className="stat"><b>{MAP_SITES.length}</b><span>sites</span></div>
                <div className="stat"><b>{STATS.countries}</b><span>countries</span></div>
                <div className="stat"><b>{STATS.unesco}</b><span>UNESCO</span></div>
              </div>
              <div className="sect"><h3>Construction era</h3>
                <div className="leg">
                  {ERAS.map((e, i) => (
                    <div key={e.name}>
                      <div className="li"><span className="dot" style={{ background: `var(--e${i + 1})` }} /><span>{e.name}</span>
                        <span className="yr">{i === 0 ? "to 550 CE" : `${fmtYear(ERAS[i - 1].to)} – ${e.to === 2031 ? "today" : fmtYear(e.to)}`}</span></div>
                      <div className="note">{e.note}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sect"><h3>Tradition (shape)</h3>
                <div className="leg tradleg">
                  {Object.entries(TRADS).map(([t, k]) => (
                    <div className="li" key={t}><svg className="shape" viewBox="0 0 11 11" style={{ fill: "var(--ink2)" }} dangerouslySetInnerHTML={{ __html: shapes[k] }} />{t}</div>
                  ))}
                </div>
              </div>
              <div className="sect"><h3>Clusters</h3><p style={{ fontSize: 12.5, color: "var(--ink2)" }}>Where sites crowd, they gather into one ring carrying the exact count. The ring is split by era colour in proportion, and one small pip sits below it for <em>every</em> tradition inside, so a mixed group never borrows a single shape. Click a ring, or press Enter on it, to zoom in.</p></div>
              <div className="sect"><h3>Keyboard</h3><p style={{ fontSize: 12.5, color: "var(--ink2)" }}>Tab walks the marks in the order they are filtered; arrow keys move faster, Home and End jump to the ends, Enter opens an entry and Escape closes it.</p></div>
              <div className="sect"><h3>While time-scrubbing</h3><p style={{ fontSize: 12.5, color: "var(--ink2)" }}>A hollow mark = site already sacred, today&apos;s structure not yet raised. It fills the year construction begins.</p></div>
            </div>
          )}
        </aside>
      </div>

      <div className="timeline">
        <div className="coachanchor">
          {coach && (
            <div className="coach" role="note" aria-label="Tip">
              <b>Try the time scrubber</b>
              <p>Drag the slider, or press play, to watch every site appear in the century it was built.</p>
              <button className="coachok" onClick={dismissCoach}>Got it</button>
            </div>
          )}
        </div>
        <div className="tl-top">
          <button className="play" aria-label={playing ? "Pause the timeline sweep" : "Play the timeline sweep"}
            aria-pressed={playing}
            onClick={() => { dismissCoach(); setPlaying(!playing); }}>{playing ? "⏸" : "▶"}</button>
          <div className="yearbox">
            <small>PERIOD</small>
            <span>{spanAll ? "All eras" : `${fmtYear(from)} – ${fmtYear(year === YEAR_MAX ? 2026 : year)}`}</span>
          </div>
          <div className="tlsvgwrap">
            <svg ref={tlRef} aria-hidden="true" />
            {/* Two overlaid range inputs rather than a custom widget. Each is a
                real slider, so it arrives keyboard-operable and announced by a
                screen reader for free; the track is click-through and only the
                thumbs take pointer events, so the nearer handle always wins.
                aria-valuetext gives the formatted year ("1010 CE") in place of
                the raw number a reader would otherwise hear (PA 5.4). */}
            <input className="tlfrom" type="range" min={YEAR_MIN} max={YEAR_MAX} step={5}
              value={from}
              aria-label="Earliest year shown"
              aria-valuetext={`from ${fmtYear(from)}`}
              onChange={(e) => { dismissCoach(); setPlaying(false); setFrom(+e.target.value); }} />
            <input className="tlto" type="range" min={YEAR_MIN} max={YEAR_MAX} step={5}
              value={Math.min(year, YEAR_MAX)}
              aria-label="Latest year shown"
              aria-valuetext={`to ${fmtYear(year === YEAR_MAX ? 2026 : year)}`}
              onChange={(e) => { dismissCoach(); setPlaying(false); setYear(+e.target.value); }} />
          </div>
          <div className="tleras" role="group" aria-label="Jump to an era">
            {ERAS.map((era, i) => {
              const lo = i === 0 ? YEAR_MIN : ERAS[i - 1].to;
              const hi = Math.min(era.to, YEAR_MAX);
              const on = from === lo && year === hi;
              return (
                <button key={era.name} className={`tlera${on ? " on" : ""}`}
                  style={{ borderColor: `var(--e${i + 1})` }}
                  aria-pressed={on}
                  title={`${fmtYear(lo)} – ${fmtYear(hi)}`}
                  onClick={() => { dismissCoach(); setPlaying(false); setRange(on ? [YEAR_MIN, YEAR_MAX] : [lo, hi]); }}>
                  {era.name}
                </button>
              );
            })}
          </div>
          <button className="showall" onClick={() => { setPlaying(false); setRange([YEAR_MIN, YEAR_MAX]); }}>show all eras</button>
        </div>
      </div>
    </>
  );
}
