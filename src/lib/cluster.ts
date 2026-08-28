/**
 * Pure marker-clustering maths for the atlas map — no DOM, no React, no data
 * import, so every rule the clustering obeys can be asserted directly (see
 * cluster.test.ts). `AtlasClient` owns the SVG; all the arithmetic lives here.
 *
 * Coordinates are **content units** — the same space `PX(lng)/PY(lat)` produce
 * and the same space the world group's `translate(x y) scale(k)` transforms.
 * That choice is the whole design, see below.
 *
 * ## Why a uniform grid and not distance-based clustering
 *
 * The obvious alternative is greedy "leader" clustering: walk the points, and
 * absorb each one into the first existing cluster within radius R. It is
 * rejected here for three reasons, in order of severity:
 *
 *  1. **Pan stability.** Grid cells are keyed to *content* coordinates, so a
 *     point's cell cannot change when the map is panned — only when the zoom
 *     changes. Leader clustering keyed to what is currently on screen makes
 *     clusters re-form and re-count while the user drags, which reads as the
 *     map lying to them. `AtlasClient` exploits this: during a pan it skips the
 *     cluster rebuild entirely, because the answer provably has not changed.
 *  2. **Cost.** One pass, O(n), one Map insert per point. Leader clustering is
 *     O(n·c) with a distance test per candidate; at 1,126 points and heading for
 *     tens of thousands, on a phone, inside a pinch, that is not affordable.
 *  3. **Determinism.** Grid output depends only on the point set and the cell
 *     size — not on iteration order, not on which point happened to become a
 *     leader first. Two renders of the same state are byte-identical, which is
 *     what makes the render cache in `AtlasClient` sound.
 *
 * The known cost of a grid is the boundary artefact: two points 1px apart either
 * side of a cell edge stay separate. That is acceptable *here* specifically
 * because the cell is sized in screen pixels (`cellSizeFor` divides by the zoom),
 * so the artefact is never larger than a single glyph and it shrinks as you zoom
 * in — which is the expansion behaviour the feature wants anyway.
 *
 * ## What a cluster is allowed to claim
 *
 * On this map era is colour and tradition is shape, and both carry meaning. A
 * cluster therefore never collapses either channel to a single value: it reports
 * the full era histogram (`eras`, drawn as proportional arcs) and every distinct
 * tradition present (`traditions`, drawn as one shape pip each). A cluster of
 * nine Hindu and one Jain site shows two pips, not one.
 */

import { clampZoom, type Extent, type View } from "./map-gestures.ts";

export type ClusterPoint = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Index into the era palette; drives the arc colour. */
  readonly era: number;
  readonly tradition: string;
};

/** How many members of a cluster belong to one era. */
export type EraShare = { readonly era: number; readonly count: number };

export type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type Cluster = {
  /** `col:row` of the grid cell — stable for as long as the cell size is. */
  readonly key: string;
  /** Centroid of the members, in content units. Not the cell centre: a cluster
   *  should sit on its sites, not on an invisible lattice. */
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly ids: readonly string[];
  readonly bounds: Bounds;
  /** Era histogram, largest share first, era index ascending on ties. */
  readonly eras: readonly EraShare[];
  /** Every distinct tradition present, alphabetical. Never truncated. */
  readonly traditions: readonly string[];
};

export type ClusterResult = {
  readonly clusters: readonly Cluster[];
  /** Ids that a cluster has taken over; the caller must hide their own marks. */
  readonly clustered: ReadonlySet<string>;
};

/**
 * Cell edge in *screen* terms, expressed in content units at zoom 1. The atlas
 * viewBox is 1480 wide, so 52 is a little over one glyph's diameter at the
 * default mark radius of 4.6 — i.e. a cell holds one legible mark.
 */
export const CLUSTER_CELL_STAGE = 52;

/**
 * A cell with fewer members than this renders its sites individually. Two marks
 * in one cell already overlap by construction, so the floor is 2.
 */
export const CLUSTER_MIN_MEMBERS = 2;

/**
 * Past this zoom nothing is ever clustered. Cell size alone would almost always
 * dissolve a cluster, but *almost* is not good enough: sites recorded at
 * identical coordinates would otherwise be permanently unreachable behind a
 * cluster that cannot be expanded by zooming into it.
 */
export const NO_CLUSTER_ZOOM = 10;

/** Glyph radius multipliers, as a fraction of the individual mark radius. */
const MIN_RADIUS_MULT = 1.5;
const MAX_RADIUS_MULT = 3.2;
const RADIUS_DECADE_STEP = 0.85;

/** Fraction of the viewport a zoom-to-bounds leaves as breathing room. */
export const BOUNDS_PADDING = 0.3;

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Cell edge in content units at a given zoom: constant on screen, shrinking in the world. */
export const cellSizeFor = (k: number): number => CLUSTER_CELL_STAGE / Math.max(k, 1e-6);

export const shouldCluster = (k: number): boolean => k < NO_CLUSTER_ZOOM;

/**
 * Bin points onto a grid of `cellSize` content units. Insertion order of the
 * returned clusters follows first appearance in `points`, so a caller that feeds
 * sites in filtered order gets clusters in filtered order — which is what keeps
 * the keyboard traversal order meaningful.
 */
export const clusterPoints = (
  points: readonly ClusterPoint[],
  cellSize: number,
  minMembers: number = CLUSTER_MIN_MEMBERS,
): ClusterResult => {
  const size = cellSize > 0 ? cellSize : 1;
  const bins = new Map<string, ClusterPoint[]>();
  for (const p of points) {
    const key = `${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`;
    const bin = bins.get(key);
    if (bin) bin.push(p);
    else bins.set(key, [p]);
  }

  const clusters: Cluster[] = [];
  const clustered = new Set<string>();
  for (const [key, members] of bins) {
    if (members.length < Math.max(2, minMembers)) continue;
    clusters.push(summarise(key, members));
    for (const m of members) clustered.add(m.id);
  }
  return { clusters, clustered };
};

const summarise = (key: string, members: readonly ClusterPoint[]): Cluster => {
  let sumX = 0, sumY = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eraCounts = new Map<number, number>();
  const traditions = new Set<string>();
  const ids: string[] = [];
  for (const m of members) {
    sumX += m.x; sumY += m.y;
    if (m.x < minX) minX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.x > maxX) maxX = m.x;
    if (m.y > maxY) maxY = m.y;
    eraCounts.set(m.era, (eraCounts.get(m.era) ?? 0) + 1);
    traditions.add(m.tradition);
    ids.push(m.id);
  }
  const eras = [...eraCounts.entries()]
    .map(([era, count]) => ({ era, count }))
    .sort((a, b) => b.count - a.count || a.era - b.era);
  return {
    key,
    x: sumX / members.length,
    y: sumY / members.length,
    count: members.length,
    ids,
    bounds: { minX, minY, maxX, maxY },
    eras,
    traditions: [...traditions].sort(),
  };
};

/**
 * Glyph radius. Area-proportional scaling is the textbook honest encoding but is
 * unusable at this spread — a 276-member cluster would be 16x the radius of a
 * 1-member one and would blanket Tamil Nadu — so the size is a capped log scale
 * and the *count is printed on the glyph*, which is the claim that has to be
 * exact. Size is a hint; the number is the fact.
 */
export const clusterRadius = (count: number, base: number): number =>
  base * clampNum(MIN_RADIUS_MULT + Math.log10(Math.max(count, 1)) * RADIUS_DECADE_STEP,
    MIN_RADIUS_MULT, MAX_RADIUS_MULT);

export const isMixedTradition = (c: Cluster): boolean => c.traditions.length > 1;
export const isMixedEra = (c: Cluster): boolean => c.eras.length > 1;

/** A point on a circle of `r` about the origin, angle measured clockwise from 12 o'clock. */
const onCircle = (r: number, angle: number) => ({
  x: r * Math.sin(angle),
  y: -r * Math.cos(angle),
});

const fixed = (n: number) => (Object.is(n, -0) ? 0 : Number(n.toFixed(2)));

export type Arc = { readonly era: number; readonly count: number; readonly d: string };

/**
 * The era histogram as proportional arcs of one ring, clockwise from 12 o'clock.
 * A single-era cluster is a whole ring — which needs two half arcs, because an
 * SVG elliptical arc whose end point equals its start point draws nothing.
 */
export const donutArcs = (eras: readonly EraShare[], radius: number): Arc[] => {
  const total = eras.reduce((n, e) => n + e.count, 0);
  if (total <= 0 || radius <= 0) return [];
  if (eras.length === 1) {
    const top = fixed(-radius), r = fixed(radius);
    return [{
      era: eras[0].era,
      count: eras[0].count,
      d: `M0 ${top}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${top}`,
    }];
  }
  const arcs: Arc[] = [];
  let angle = 0;
  for (const e of eras) {
    const sweep = (e.count / total) * Math.PI * 2;
    const from = onCircle(radius, angle);
    const to = onCircle(radius, angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    arcs.push({
      era: e.era,
      count: e.count,
      d: `M${fixed(from.x)} ${fixed(from.y)}A${fixed(radius)} ${fixed(radius)} 0 ${large} 1 ${fixed(to.x)} ${fixed(to.y)}`,
    });
    angle += sweep;
  }
  return arcs;
};

/**
 * Horizontal offsets for the tradition pips, centred under the glyph. One pip per
 * distinct tradition, in the order `traditions` reports them, so the row is
 * stable across renders.
 */
export const pipOffsets = (n: number, pipRadius: number, gap = 1.1): number[] => {
  if (n <= 0) return [];
  const step = pipRadius * 2 + gap;
  const start = -((n - 1) * step) / 2;
  return Array.from({ length: n }, (_, i) => fixed(start + i * step));
};

/**
 * The view that frames a set of bounds. Returned raw: the caller feeds it to
 * `setView`, which is the only writer of view state and applies `clampTranslate`.
 * Degenerate bounds (every member at one coordinate) fall through to MAX_ZOOM
 * via `clampZoom`, and `NO_CLUSTER_ZOOM` then guarantees the cluster dissolves.
 */
export const viewForBounds = (
  bounds: Bounds,
  extent: Extent,
  padding: number = BOUNDS_PADDING,
): View => {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6) * (1 + padding);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6) * (1 + padding);
  const k = clampZoom(Math.min(extent.width / width, extent.height / height));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, x: extent.width / 2 - cx * k, y: extent.height / 2 - cy * k };
};

/**
 * What the cluster tells a screen reader. Deliberately spells out the mix rather
 * than naming a majority: "9 Hindu, 1 Jain", never "Hindu".
 */
export const clusterAriaLabel = (c: Cluster, eraNames: readonly string[]): string => {
  const eras = c.eras
    .map((e) => `${e.count} ${eraNames[e.era] ?? `era ${e.era + 1}`}`)
    .join(", ");
  const trads = c.traditions.join(", ");
  return `Cluster of ${c.count} sites. Traditions: ${trads}. Eras: ${eras}. Activate to zoom to this group.`;
};

/** The same composition, phrased for the hover tooltip. */
export const clusterSummary = (c: Cluster): string =>
  isMixedTradition(c) ? `mixed — ${c.traditions.join(" · ")}` : c.traditions[0] ?? "";
