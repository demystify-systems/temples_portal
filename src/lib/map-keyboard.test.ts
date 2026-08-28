import test from "node:test";
import assert from "node:assert/strict";
import {
  MARK_DOM_PREFIX, CLUSTER_DOM_PREFIX, CONTESTED_BADGE, CIRCUIT_ORDER_NOTE,
  domIdFor, targetFromDomId, focusOrder, stepFocus, keyIntent, resolveMove,
  circuitRoute, contestsCircuit, badgeFor,
  type FocusTarget, type CircuitCandidate,
} from "./map-keyboard.ts";

const mark = (id: string): FocusTarget => ({ kind: "mark", id });
const cluster = (id: string): FocusTarget => ({ kind: "cluster", id });

/* ------------------------------------------------------------- dom ids */

test("dom ids round-trip for both kinds", () => {
  for (const t of [mark("brihadeeswarar"), cluster("12:7")]) {
    assert.deepEqual(targetFromDomId(domIdFor(t)), t);
  }
});

test("a cluster id is never mistaken for a site id", () => {
  assert.equal(domIdFor(cluster("x")).startsWith(CLUSTER_DOM_PREFIX), true);
  assert.equal(domIdFor(mark("x")).startsWith(MARK_DOM_PREFIX), true);
  assert.equal(targetFromDomId(domIdFor(cluster("x")))!.kind, "cluster");
});

test("ids that are not the map's are rejected rather than half-parsed", () => {
  assert.equal(targetFromDomId(null), null);
  assert.equal(targetFromDomId(""), null);
  assert.equal(targetFromDomId("fwrap"), null);
  assert.equal(targetFromDomId(MARK_DOM_PREFIX), null, "prefix with no id is not a target");
});

/* -------------------------------------------------------- focus order */

test("focus order is clusters first, then marks in the caller's filtered order", () => {
  const order = focusOrder(["0:0", "3:4"], ["c", "a", "b"]);
  assert.deepEqual(order, [cluster("0:0"), cluster("3:4"), mark("c"), mark("a"), mark("b")]);
});

test("the filtered order is passed through untouched — never re-sorted", () => {
  const filtered = ["zzz", "aaa", "mmm"];
  assert.deepEqual(focusOrder([], filtered).map((t) => t.id), filtered);
});

test("an empty map has no focus order and no crash", () => {
  assert.deepEqual(focusOrder([], []), []);
  assert.equal(stepFocus([], null, 1), null);
  assert.equal(resolveMove([], null, "first"), null);
});

test("stepping moves one place and wraps at both ends", () => {
  const order = focusOrder([], ["a", "b", "c"]);
  assert.deepEqual(stepFocus(order, mark("a"), 1), mark("b"));
  assert.deepEqual(stepFocus(order, mark("c"), 1), mark("a"), "wraps forward");
  assert.deepEqual(stepFocus(order, mark("a"), -1), mark("c"), "wraps back");
});

test("a target that has been filtered away re-enters at the near end", () => {
  const order = focusOrder([], ["a", "b"]);
  assert.deepEqual(stepFocus(order, mark("gone"), 1), mark("a"));
  assert.deepEqual(stepFocus(order, mark("gone"), -1), mark("b"));
  assert.deepEqual(stepFocus(order, null, 1), mark("a"));
});

test("stepping crosses the cluster/mark boundary in one move", () => {
  const order = focusOrder(["0:0"], ["a"]);
  assert.deepEqual(stepFocus(order, cluster("0:0"), 1), mark("a"));
  assert.deepEqual(stepFocus(order, mark("a"), -1), cluster("0:0"));
});

test("a cluster and a mark sharing an id string are still distinct stops", () => {
  const order = focusOrder(["shared"], ["shared"]);
  assert.deepEqual(stepFocus(order, cluster("shared"), 1), mark("shared"));
});

/* ------------------------------------------------------------- intents */

test("arrows move, Home and End jump, Enter and Space activate, Escape dismisses", () => {
  assert.equal(keyIntent({ key: "ArrowRight" }), "next");
  assert.equal(keyIntent({ key: "ArrowDown" }), "next");
  assert.equal(keyIntent({ key: "ArrowLeft" }), "previous");
  assert.equal(keyIntent({ key: "ArrowUp" }), "previous");
  assert.equal(keyIntent({ key: "Home" }), "first");
  assert.equal(keyIntent({ key: "End" }), "last");
  assert.equal(keyIntent({ key: "Enter" }), "activate");
  assert.equal(keyIntent({ key: " " }), "activate");
  assert.equal(keyIntent({ key: "Escape" }), "dismiss");
});

test("Tab is never claimed — DOM order is what makes it correct", () => {
  assert.equal(keyIntent({ key: "Tab" }), null);
  assert.equal(keyIntent({ key: "Tab", shiftKey: true }), null);
});

test("modified presses belong to the browser, not to the map", () => {
  assert.equal(keyIntent({ key: "ArrowRight", metaKey: true }), null);
  assert.equal(keyIntent({ key: "Home", ctrlKey: true }), null);
  assert.equal(keyIntent({ key: "ArrowDown", shiftKey: true }), null, "shift+arrow selects text");
  assert.equal(keyIntent({ key: "Enter", altKey: true }), null);
});

test("Escape survives Shift, because Shift+Escape is nobody's shortcut", () => {
  assert.equal(keyIntent({ key: "Escape", shiftKey: true }), "dismiss");
  assert.equal(keyIntent({ key: "Escape", metaKey: true }), null);
});

test("unknown keys are ignored so typing never hijacks the map", () => {
  for (const key of ["a", "1", "F5", "PageDown", "Backspace"]) {
    assert.equal(keyIntent({ key }), null, key);
  }
});

test("resolveMove turns an intent into a target, and refuses non-moves", () => {
  const order = focusOrder([], ["a", "b", "c"]);
  assert.deepEqual(resolveMove(order, mark("b"), "next"), mark("c"));
  assert.deepEqual(resolveMove(order, mark("b"), "previous"), mark("a"));
  assert.deepEqual(resolveMove(order, mark("b"), "first"), mark("a"));
  assert.deepEqual(resolveMove(order, mark("b"), "last"), mark("c"));
  assert.equal(resolveMove(order, mark("b"), "activate"), null);
  assert.equal(resolveMove(order, mark("b"), "dismiss"), null);
});

/* ------------------------------------------------------ circuit order */

const candidate = (
  id: string, name: string, lat: number, lng: number, contested = false,
): CircuitCandidate => ({ id, name, lat, lng, contested });

test("stops are numbered north to south", () => {
  const route = circuitRoute([
    candidate("s", "South", 8.08, 77.5),
    candidate("n", "North", 30.7, 79.4),
    candidate("m", "Middle", 20.1, 78.0),
  ]);
  assert.deepEqual(route.stops.map((s) => s.id), ["n", "m", "s"]);
  assert.deepEqual(route.stops.map((s) => s.ordinal), [1, 2, 3]);
});

test("ties break west to east, then by name, then by id — never by input order", () => {
  const sameLat = [
    candidate("b", "Beta", 20, 79),
    candidate("a", "Alpha", 20, 77),
    candidate("c", "Alpha", 20, 77),
  ];
  const forward = circuitRoute(sameLat).stops.map((s) => s.id);
  const reversed = circuitRoute([...sameLat].reverse()).stops.map((s) => s.id);
  assert.deepEqual(forward, ["a", "c", "b"]);
  assert.deepEqual(forward, reversed, "ordering does not depend on input order");
});

test("circuitRoute does not mutate the array it is given", () => {
  const input = [candidate("s", "South", 8, 77), candidate("n", "North", 30, 79)];
  const snapshot = input.map((c) => c.id);
  circuitRoute(input);
  assert.deepEqual(input.map((c) => c.id), snapshot);
});

test("a contested claim is separated out and never given an ordinal", () => {
  const route = circuitRoute([
    candidate("deoghar", "Baidyanath Deoghar", 24.49, 86.70, true),
    candidate("parli", "Vaijnath Parli", 18.85, 76.53, true),
    candidate("somnath", "Somnath", 20.89, 70.40),
    candidate("kedar", "Kedarnath", 30.73, 79.07),
  ]);
  assert.deepEqual(route.stops.map((s) => [s.id, s.ordinal]), [["kedar", 1], ["somnath", 2]]);
  assert.deepEqual(route.contested.map((s) => s.id), ["deoghar", "parli"]);
  assert.deepEqual(route.contested.map((s) => s.ordinal), [null, null]);
});

test("contested members do not consume numbers, so the roster count stays honest", () => {
  const route = circuitRoute([
    candidate("a", "A", 30, 70),
    candidate("x", "X", 25, 70, true),
    candidate("b", "B", 20, 70),
  ]);
  assert.deepEqual(route.stops.map((s) => s.ordinal), [1, 2], "not 1 and 3");
  assert.equal(route.stops.length + route.contested.length, 3);
});

test("contested stops keep the same geographic ordering among themselves", () => {
  const route = circuitRoute([
    candidate("south", "S", 10, 78, true),
    candidate("north", "N", 32, 78, true),
  ]);
  assert.deepEqual(route.contested.map((s) => s.id), ["north", "south"]);
});

test("an all-contested circuit numbers nothing at all", () => {
  const route = circuitRoute([candidate("a", "A", 10, 70, true), candidate("b", "B", 20, 70, true)]);
  assert.deepEqual(route.stops, []);
  assert.equal(route.contested.length, 2);
});

test("an empty circuit is an empty route", () => {
  assert.deepEqual(circuitRoute([]), { stops: [], contested: [] });
});

test("contestsCircuit reads the record's own dispute list, exactly", () => {
  const disputed = [{ circuit: "Jyotirlinga" }, { circuit: "Shakti Peetha" }];
  assert.equal(contestsCircuit(disputed, "Jyotirlinga"), true);
  assert.equal(contestsCircuit(disputed, "Char Dham"), false);
  assert.equal(contestsCircuit(undefined, "Jyotirlinga"), false);
  assert.equal(contestsCircuit([], "Jyotirlinga"), false);
  assert.equal(contestsCircuit(disputed, "jyotirlinga"), false, "no fuzzy matching on a claim");
});

test("the badge is the number, or the dagger that says 'contested'", () => {
  const route = circuitRoute([candidate("a", "A", 20, 70), candidate("x", "X", 10, 70, true)]);
  assert.equal(badgeFor(route.stops[0]), "1");
  assert.equal(badgeFor(route.contested[0]), CONTESTED_BADGE);
  assert.notEqual(CONTESTED_BADGE, "", "a contested stop must still carry a visible mark");
});

test("the ordering the UI prints matches the ordering the code performs", () => {
  assert.match(CIRCUIT_ORDER_NOTE, /north to south/i);
  assert.match(CIRCUIT_ORDER_NOTE, /not a canonical sequence/i);
});
