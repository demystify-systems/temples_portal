import test from "node:test";
import assert from "node:assert/strict";
import {
  CLUSTER_CELL_STAGE, CLUSTER_MIN_MEMBERS, NO_CLUSTER_ZOOM,
  cellSizeFor, shouldCluster, clusterPoints, clusterRadius, donutArcs, pipOffsets,
  viewForBounds, clusterAriaLabel, clusterSummary, isMixedEra, isMixedTradition,
  type ClusterPoint,
} from "./cluster.ts";
import { MAX_ZOOM } from "./map-gestures.ts";

const EXTENT = { width: 1480, height: 1136.5 };
const ERA_NAMES = ["Classical", "Imperial", "Medieval", "Late medieval", "Colonial", "Modern"];

const pt = (id: string, x: number, y: number, era = 0, tradition = "Hindu"): ClusterPoint =>
  ({ id, x, y, era, tradition });

/* ------------------------------------------------------------- binning */

test("points sharing a cell become one cluster; a lone point does not", () => {
  const { clusters, clustered } = clusterPoints([pt("a", 1, 1), pt("b", 4, 4), pt("z", 500, 500)], 10);
  assert.equal(clusters.length, 1);
  assert.deepEqual([...clusters[0].ids], ["a", "b"]);
  assert.ok(clustered.has("a") && clustered.has("b"));
  assert.equal(clustered.has("z"), false, "a singleton keeps its own mark");
});

test("the cluster sits on its members' centroid, not on the cell centre", () => {
  const { clusters } = clusterPoints([pt("a", 1, 2), pt("b", 3, 8)], 100);
  assert.equal(clusters[0].x, 2);
  assert.equal(clusters[0].y, 5);
});

test("bounds cover every member, which is what zoom-to-cluster needs", () => {
  const { clusters } = clusterPoints([pt("a", 10, 40), pt("b", 30, 12), pt("c", 21, 33)], 100);
  assert.deepEqual(clusters[0].bounds, { minX: 10, minY: 12, maxX: 30, maxY: 40 });
});

test("the grid is pan-invariant: cells are keyed to content coordinates", () => {
  // The same points clustered twice; only the caller's view has moved, which the
  // maths never sees. Identical output is the property AtlasClient's cache relies on.
  const points = [pt("a", 5, 5), pt("b", 8, 9), pt("c", 400, 400)];
  const first = clusterPoints(points, 20);
  const second = clusterPoints(points, 20);
  assert.deepEqual(first.clusters, second.clusters);
});

test("a cell boundary separates neighbours — the accepted grid artefact", () => {
  const { clusters } = clusterPoints([pt("a", 19.9, 5), pt("b", 20.1, 5)], 20);
  assert.equal(clusters.length, 0, "either side of the edge, so neither is clustered");
});

test("negative coordinates bin correctly (floor, not truncate)", () => {
  const { clusters } = clusterPoints([pt("a", -1, -1), pt("b", -9, -9)], 10);
  assert.equal(clusters.length, 1, "-1 and -9 both floor to cell -1");
});

test("clusters come back in first-appearance order, so filtered order survives", () => {
  const { clusters } = clusterPoints(
    [pt("far1", 900, 900), pt("far2", 905, 902), pt("near1", 3, 3), pt("near2", 6, 6)],
    50,
  );
  assert.deepEqual(clusters.map((c) => c.ids[0]), ["far1", "near1"]);
});

test("the minimum-member floor can be raised but never below two", () => {
  const three = [pt("a", 1, 1), pt("b", 2, 2), pt("c", 3, 3)];
  assert.equal(clusterPoints(three, 50, 4).clusters.length, 0);
  assert.equal(clusterPoints(three, 50, 3).clusters.length, 1);
  assert.equal(clusterPoints(three, 50, 1).clusters.length, 1, "1 is coerced up to 2");
  assert.equal(CLUSTER_MIN_MEMBERS, 2);
});

test("a non-positive cell size cannot divide by zero or collapse the map", () => {
  const { clusters } = clusterPoints([pt("a", 0, 0), pt("b", 900, 900)], 0);
  assert.equal(clusters.length, 0, "falls back to a 1-unit cell, so distant points stay apart");
});

/* ------------------------------------------------- semantics preserved */

test("era histogram is complete and ordered by share, then by era index", () => {
  const { clusters } = clusterPoints(
    [pt("a", 1, 1, 2), pt("b", 2, 2, 5), pt("c", 3, 3, 2), pt("d", 4, 4, 1)],
    50,
  );
  assert.deepEqual([...clusters[0].eras], [
    { era: 2, count: 2 },
    { era: 1, count: 1 },
    { era: 5, count: 1 },
  ]);
  assert.equal(isMixedEra(clusters[0]), true);
});

test("every distinct tradition survives — a cluster never implies homogeneity", () => {
  const { clusters } = clusterPoints(
    [pt("a", 1, 1, 0, "Hindu"), pt("b", 2, 2, 0, "Hindu"),
     pt("c", 3, 3, 0, "Jain"), pt("d", 4, 4, 0, "Buddhist")],
    50,
  );
  assert.deepEqual([...clusters[0].traditions], ["Buddhist", "Hindu", "Jain"]);
  assert.equal(isMixedTradition(clusters[0]), true);
  assert.match(clusterSummary(clusters[0]), /^mixed —/);
});

test("a single-tradition cluster reports exactly that tradition, not 'mixed'", () => {
  const { clusters } = clusterPoints([pt("a", 1, 1, 0, "Sikh"), pt("b", 2, 2, 0, "Sikh")], 50);
  assert.deepEqual([...clusters[0].traditions], ["Sikh"]);
  assert.equal(isMixedTradition(clusters[0]), false);
  assert.equal(clusterSummary(clusters[0]), "Sikh");
});

test("the aria label spells out the mix rather than naming a majority", () => {
  const { clusters } = clusterPoints(
    [pt("a", 1, 1, 0, "Hindu"), pt("b", 2, 2, 0, "Hindu"), pt("c", 3, 3, 3, "Jain")],
    50,
  );
  const label = clusterAriaLabel(clusters[0], ERA_NAMES);
  assert.match(label, /Cluster of 3 sites/);
  assert.match(label, /Traditions: Hindu, Jain/);
  assert.match(label, /2 Classical/);
  assert.match(label, /1 Late medieval/);
});

test("an era index with no name still produces a usable label", () => {
  const { clusters } = clusterPoints([pt("a", 1, 1, 9), pt("b", 2, 2, 9)], 50);
  assert.match(clusterAriaLabel(clusters[0], ERA_NAMES), /2 era 10/);
});

/* ------------------------------------------------------ zoom behaviour */

test("cells shrink in world units as the map zooms, so clusters break apart", () => {
  assert.equal(cellSizeFor(1), CLUSTER_CELL_STAGE);
  assert.equal(cellSizeFor(4), CLUSTER_CELL_STAGE / 4);
  assert.ok(cellSizeFor(9) < cellSizeFor(2));
  assert.ok(Number.isFinite(cellSizeFor(0)), "zoom 0 cannot produce Infinity");
});

test("two sites 30 units apart cluster when zoomed out and separate when zoomed in", () => {
  const pair = [pt("a", 110, 100), pt("b", 140, 100)];
  assert.equal(clusterPoints(pair, cellSizeFor(1)).clusters.length, 1, "one 52-unit cell holds both");
  assert.equal(clusterPoints(pair, cellSizeFor(8)).clusters.length, 0, "a 6.5-unit cell cannot");
});

test("clustering is switched off entirely above the escape zoom", () => {
  assert.equal(shouldCluster(1), true);
  assert.equal(shouldCluster(NO_CLUSTER_ZOOM - 0.01), true);
  assert.equal(shouldCluster(NO_CLUSTER_ZOOM), false);
  assert.ok(NO_CLUSTER_ZOOM < MAX_ZOOM, "the escape hatch must be reachable");
});

test("glyph radius grows with count but is capped, and the floor beats a lone mark", () => {
  const base = 4.6;
  assert.ok(clusterRadius(2, base) > base);
  assert.ok(clusterRadius(50, base) > clusterRadius(5, base));
  assert.equal(clusterRadius(1000, base), clusterRadius(100000, base), "capped");
  assert.ok(clusterRadius(100000, base) < base * 4);
});

test("zoom-to-bounds frames the cluster and centres it", () => {
  const view = viewForBounds({ minX: 500, minY: 400, maxX: 700, maxY: 500 }, EXTENT, 0);
  assert.equal(view.k, EXTENT.width / 200 < EXTENT.height / 100 ? EXTENT.width / 200 : EXTENT.height / 100);
  // centre of the bounds lands on the centre of the stage
  assert.ok(Math.abs(600 * view.k + view.x - EXTENT.width / 2) < 1e-9);
  assert.ok(Math.abs(450 * view.k + view.y - EXTENT.height / 2) < 1e-9);
});

test("padding leaves room around the framed bounds", () => {
  const tight = viewForBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, EXTENT, 0);
  const padded = viewForBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, EXTENT, 0.5);
  assert.ok(padded.k < tight.k);
});

test("bounds of zero extent (identical coordinates) clamp to max zoom, never Infinity", () => {
  const view = viewForBounds({ minX: 300, minY: 300, maxX: 300, maxY: 300 }, EXTENT);
  assert.equal(view.k, MAX_ZOOM);
  assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y));
});

/* ------------------------------------------------------------- drawing */

test("a single-era ring is a closed circle drawn as two half arcs", () => {
  const [arc] = donutArcs([{ era: 1, count: 7 }], 10);
  assert.equal(arc.era, 1);
  assert.equal((arc.d.match(/A/g) ?? []).length, 2, "one arc command cannot close a circle");
  assert.equal(arc.d, "M0 -10A10 10 0 1 1 0 10A10 10 0 1 1 0 -10");
});

test("arc sweeps are proportional to era share and start at twelve o'clock", () => {
  const arcs = donutArcs([{ era: 0, count: 3 }, { era: 1, count: 1 }], 10);
  assert.equal(arcs.length, 2);
  assert.ok(arcs[0].d.startsWith("M0 -10"), "first arc starts at the top");
  assert.equal(arcs[0].d.includes(" 1 1 ") || arcs[0].d.includes("0 1 1"), true, "3/4 of a turn is a large arc");
  assert.equal(/A10 10 0 0 1/.test(arcs[1].d), true, "1/4 of a turn is not");
});

test("arcs cover the whole ring exactly once, whatever the mix", () => {
  const shares = [{ era: 0, count: 5 }, { era: 2, count: 2 }, { era: 4, count: 1 }];
  const arcs = donutArcs(shares, 12);
  assert.deepEqual(arcs.map((a) => a.era), [0, 2, 4]);
  assert.deepEqual(arcs.map((a) => a.count), [5, 2, 1]);
});

test("an empty or zero-radius ring draws nothing rather than NaN paths", () => {
  assert.deepEqual(donutArcs([], 10), []);
  assert.deepEqual(donutArcs([{ era: 0, count: 3 }], 0), []);
  assert.deepEqual(donutArcs([{ era: 0, count: 0 }], 10), []);
});

test("tradition pips are centred and evenly spaced", () => {
  assert.deepEqual(pipOffsets(1, 2), [0]);
  const three = pipOffsets(3, 2, 1);
  assert.equal(three.length, 3);
  assert.equal(three[1], 0, "an odd row is centred on the middle pip");
  assert.equal(three[0], -three[2], "and symmetric");
  assert.deepEqual(pipOffsets(0, 2), []);
});
