/**
 * The corpus as the MAP sees it — every field AtlasClient reads, and not one more.
 *
 * Why this module exists
 * ---------------------
 * `AtlasClient.tsx` is a `"use client"` component and imported `SITES` from
 * `@/lib/sites`, which does `import rawSites from "../../data/sites.json"`.
 * Webpack therefore inlined the ENTIRE corpus into the homepage chunk. Measured
 * on the real build at 3,031 records: `app/page-*.js` was **922.1 kB gzipped**
 * and the homepage shipped **1,025.7 kB** of JavaScript, against a 200 kB
 * budget. Every visitor downloaded every `significance` paragraph, every
 * `story`, every `sources` array — to draw dots on a map.
 *
 * The fix is not to shrink the corpus. It is to stop shipping the parts of it
 * the map never reads. Measured gzip, per column, at 3,031 records:
 *
 *   deity 30.7   id 28.5   name 26.7   place 23.5   builtDisplay 21.3
 *   native 10.5  style 9.7  lat 9.5   lng 9.5      dynasty 8.8
 *   built 7.3    state 4.0  disputedCircuits 2.7   circuits 0.8
 *   country 0.6  tradition 0.5   alt 0.2   tier 0.2
 *
 * That is 194.9 kB for everything the map and the gazetteer between them read —
 * against 778.5 kB for the corpus as it used to ship. The prose is the rest.
 *
 * Where each field comes from
 * ---------------------------
 * `SEARCH_INDEX` (src/lib/search-index.ts) already carried everything except
 * coordinates, because `/sites` was migrated to it first. Sharing that module
 * between `/` and `/sites` is deliberate: it is ONE chunk, so a visitor who
 * lands on the atlas and then opens the gazetteer downloads nothing new.
 *
 * `GEO_COLUMNS` (generated) adds `lat`, `lng` and `disputedCircuits` — the three
 * fields only the map reads. They are a separate module so the gazetteer does
 * not download 3,031 coordinate pairs it will never plot.
 *
 * What is NOT here
 * ---------------
 * `significance`, `story`, `access`, `sources`, `website`, `phone`, `wiki`,
 * `patron`, `origin`, `originNote` and `status`. The detail rail renders all of
 * them, and it renders them for ONE record at a time — so they are fetched for
 * that record on selection (`loadRecord`) rather than bundled for all 3,031.
 * Nothing on this page needs a second record's prose, ever.
 */

import { SEARCH_INDEX, type IndexedSite } from "./search-index.ts";
import { GEO_COLUMNS, type DisputedCircuitRow } from "./generated/search-index-geo.ts";

export type DisputedCircuit = {
  readonly circuit: string;
  readonly status: "disputed" | "unsourced";
  readonly note: string;
  readonly source?: string;
};

/**
 * A record with everything the map draws, filters, ranks and tooltips with.
 *
 * Structurally a superset of `IndexedSite`, so `search.ts`'s `filterSites`,
 * `facetsOf` and `matches` keep working on it unchanged.
 */
export type MapSite = IndexedSite & {
  readonly lat: number;
  readonly lng: number;
  readonly disputedCircuits?: readonly DisputedCircuit[];
};

/** `0` is how the generator writes "no contested claim" — 1 byte, not 2. */
const disputesAt = (row: DisputedCircuitRow): readonly DisputedCircuit[] | undefined =>
  row === 0 ? undefined : (row as readonly DisputedCircuit[]);

/**
 * Every record, in corpus order, with its coordinates attached.
 *
 * Built once at module load by walking two frozen arrays — 3,031 object spreads,
 * well under a millisecond, and it keeps `SEARCH_INDEX`'s identity guarantee
 * intact for the gazetteer: those records are NOT mutated here, they are copied.
 * That matters because `search.ts` caches each record's folded haystack in a
 * `WeakMap` keyed by object identity, and mutating a shared record after its
 * first search would leave it matching against stale text.
 */
export const MAP_SITES: readonly MapSite[] = Object.freeze(
  SEARCH_INDEX.map((record, i) => ({
    ...record,
    lat: GEO_COLUMNS.lat[i],
    lng: GEO_COLUMNS.lng[i],
    disputedCircuits: disputesAt(GEO_COLUMNS.disputedCircuits[i]),
  })),
);

/** Id lookup. `ringSpot` runs once per animation frame; a linear scan is not free. */
export const MAP_SITE_BY_ID: ReadonlyMap<string, MapSite> = new Map(
  MAP_SITES.map((s) => [s.id, s] as const),
);
