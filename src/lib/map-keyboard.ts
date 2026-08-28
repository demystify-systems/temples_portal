/**
 * Pure ordering and traversal for the atlas map — no DOM, no React, no data
 * import (see map-keyboard.test.ts). Two jobs, both of them "what order are
 * these things in and what does this key mean":
 *
 *  1. **Keyboard focus order** for the marks and clusters on the map (T-043).
 *  2. **Circuit ordinal order** for circuit mode (T-046) — which stop is
 *     number 1, and which claims may not be numbered at all.
 *
 * `AtlasClient` owns the elements, the focus calls and the event listeners.
 */

/* ===================================================== keyboard traversal */

export type FocusKind = "mark" | "cluster";
export type FocusTarget = { readonly kind: FocusKind; readonly id: string };

export const MARK_DOM_PREFIX = "atlas-mark-";
export const CLUSTER_DOM_PREFIX = "atlas-cluster-";

export const domIdFor = (target: FocusTarget): string =>
  `${target.kind === "cluster" ? CLUSTER_DOM_PREFIX : MARK_DOM_PREFIX}${target.id}`;

export const targetFromDomId = (domId: string | null | undefined): FocusTarget | null => {
  if (!domId) return null;
  if (domId.startsWith(CLUSTER_DOM_PREFIX)) {
    const id = domId.slice(CLUSTER_DOM_PREFIX.length);
    return id ? { kind: "cluster", id } : null;
  }
  if (domId.startsWith(MARK_DOM_PREFIX)) {
    const id = domId.slice(MARK_DOM_PREFIX.length);
    return id ? { kind: "mark", id } : null;
  }
  return null;
};

/**
 * The traversal order, and by construction also the DOM order `AtlasClient`
 * builds — which is what makes plain Tab work without a single positive
 * tabindex anywhere.
 *
 * Clusters come first because they are the aggregate: at zoom 1 almost every
 * site is inside one, so a keyboard user meets ~100 cluster stops rather than
 * 1,126 mark stops, and zooming into a cluster is what reveals its members.
 * Individual marks then follow **in the caller's filtered order** — the array is
 * passed through untouched, deliberately: the visible order on screen, the tab
 * order and the gazetteer order must be the same order or none of them mean
 * anything.
 */
export const focusOrder = (
  clusterKeys: readonly string[],
  markIds: readonly string[],
): FocusTarget[] => [
  ...clusterKeys.map((id): FocusTarget => ({ kind: "cluster", id })),
  ...markIds.map((id): FocusTarget => ({ kind: "mark", id })),
];

/**
 * Move `delta` places through the order, wrapping at both ends. An unknown or
 * absent current target enters at the first element (or the last, going back),
 * so an arrow key always lands somewhere as long as anything is focusable.
 */
export const stepFocus = (
  order: readonly FocusTarget[],
  current: FocusTarget | null,
  delta: number,
): FocusTarget | null => {
  if (order.length === 0) return null;
  const at = current
    ? order.findIndex((t) => t.kind === current.kind && t.id === current.id)
    : -1;
  if (at < 0) return delta < 0 ? order[order.length - 1] : order[0];
  const next = (((at + delta) % order.length) + order.length) % order.length;
  return order[next];
};

export type KeyIntent = "next" | "previous" | "first" | "last" | "activate" | "dismiss";

export type KeyLike = {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
};

/**
 * What a keypress on a mark means. Any modifier other than a bare press yields
 * `null`: Cmd+Arrow, Ctrl+Home and Shift+Arrow belong to the browser and to text
 * selection, and a map has no business intercepting them. Tab is absent on
 * purpose — it is the browser's, and DOM order already makes it correct.
 */
export const keyIntent = (event: KeyLike): KeyIntent | null => {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "Escape") return "dismiss";
  if (event.shiftKey) return null;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Enter":
    case " ":
    case "Spacebar":
      return "activate";
    default:
      return null;
  }
};

/** Resolve an intent against the order. Returns null for intents that are not moves. */
export const resolveMove = (
  order: readonly FocusTarget[],
  current: FocusTarget | null,
  intent: KeyIntent,
): FocusTarget | null => {
  if (order.length === 0) return null;
  switch (intent) {
    case "next": return stepFocus(order, current, 1);
    case "previous": return stepFocus(order, current, -1);
    case "first": return order[0];
    case "last": return order[order.length - 1];
    default: return null;
  }
};

/* ======================================================= circuit ordering */

export type CircuitCandidate = {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  /** True when this record's own data flags its membership of this circuit as contested. */
  readonly contested: boolean;
};

export type CircuitStop = CircuitCandidate & {
  /** 1-based position, or null for a contested claim, which is never ranked. */
  readonly ordinal: number | null;
};

export type CircuitRoute = {
  /** Uncontested members, numbered 1..n in the documented order. */
  readonly stops: readonly CircuitStop[];
  /** Contested claims, in the same order but deliberately unnumbered. */
  readonly contested: readonly CircuitStop[];
};

/**
 * How the numbers are chosen, stated in the product and not only in this comment
 * — the panel prints this string.
 */
export const CIRCUIT_ORDER_NOTE =
  "Numbered north to south. The dataset records no traditional ordinal for this circuit, " +
  "so this is a geographic ordering, not a canonical sequence.";

/**
 * ## Why geographic and not roster order
 *
 * `data/rosters/` holds canonical, ordered rosters for three circuits, and roster
 * order was the first choice. It was measured and rejected: joining roster rows
 * to `data/sites.json` records has no key. Matching on normalised temple name
 * hits 4 of 106 Divya Desam rows and 9 of 50 Shakti Peetha rows (the rosters use
 * Tamil shrine names, the corpus uses the common English name); matching on
 * place hits 78 of 106 and is ambiguous where a town holds several shrines. A
 * ~74%-reliable fuzzy join would silently mis-rank a quarter of the stops while
 * *looking* canonical — which is precisely the "no source, no field" rule in
 * CLAUDE.md. Until the rosters carry site ids, the honest ordering is one the
 * data can actually support, labelled as what it is.
 *
 * So: **north to south by latitude, then west to east, then by name, then by id.**
 * Fully deterministic, stable under filtering, and true of the coordinates that
 * are in the record.
 *
 * ## Contested members
 *
 * A record whose own `disputedCircuits` flags this circuit keeps its place on the
 * map but is never given an integer: numbering it would assert a canonical slot
 * that four rival temples claim. It is separated out, so "12 Jyotirlingas" does
 * not quietly become fourteen.
 */
export const circuitRoute = (members: readonly CircuitCandidate[]): CircuitRoute => {
  const ordered = [...members].sort(
    (a, b) =>
      b.lat - a.lat ||
      a.lng - b.lng ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  const stops: CircuitStop[] = [];
  const contested: CircuitStop[] = [];
  for (const m of ordered) {
    if (m.contested) contested.push({ ...m, ordinal: null });
    else stops.push({ ...m, ordinal: stops.length + 1 });
  }
  return { stops, contested };
};

/** Does this record's own data contest its membership of `circuit`? */
export const contestsCircuit = (
  disputed: readonly { readonly circuit: string }[] | undefined,
  circuit: string,
): boolean => (disputed ?? []).some((d) => d.circuit === circuit);

/** Map from site id to the badge a mark should carry: "7", or the contested dagger. */
export const CONTESTED_BADGE = "†";

export const badgeFor = (stop: CircuitStop): string =>
  stop.ordinal === null ? CONTESTED_BADGE : String(stop.ordinal);
