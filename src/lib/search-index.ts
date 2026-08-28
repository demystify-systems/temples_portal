/**
 * The client search index — the corpus, minus everything a list page never reads.
 *
 * `SiteFilters.tsx` imports the whole of `data/sites.json` today, so every list
 * page ships 309 kB gzipped to the browser. Two thirds of that is fields no list
 * page touches: `story` (48 kB of legend prose that `search.ts` never even
 * looks at), `sources`, coordinates, `access`, `wiki`, `patron`,
 * `disputedCircuits`, `status`, `origin`. This module exposes the same records
 * with only the fields `search.ts` searches and `SiteFilters` renders — 183.6 kB
 * gzipped, with no loss of search recall at all.
 *
 * `SEARCH_INDEX` is structurally assignable to `Searchable`, so `filterSites`,
 * `facetsOf` and `matches` work on it unchanged — swapping `SITES` for
 * `SEARCH_INDEX` in a list page is a one-line change.
 *
 * The corpus stays canonical (constitution rule 6). This is a projection of it,
 * regenerated from it on every build, and it adds nothing: no field here holds a
 * value `data/sites.json` does not already hold, verbatim.
 *
 * `deities` and `deityGroup` ride the CRITICAL path alongside the other facet
 * fields, not the deferred `significance` chunk. A facet has to be counted
 * before the reader types — deferring them would render the deity filter empty
 * on arrival — and they are drawn from a closed vocabulary of a few dozen words,
 * so they compress to almost nothing next to the free-text `deity` column.
 */

import type { Searchable } from "./search.ts";
import { COLUMNS, RECORD_COUNT } from "./generated/search-index.ts";

/**
 * A record as the list pages see it: everything `search.ts` reads, plus the
 * `id` its links need and the `builtDisplay` its cards print.
 *
 * `builtDisplay` is carried rather than derived from `built`. It is editorial
 * text — "c. 700 CE", "Chola core; Vijayanagara gopuram 1509", "dating
 * unrecorded" — and only 4 of 1,126 records would survive being re-rendered
 * from the year pair. Deriving the other 1,122 would be inventing a fact the
 * sources do not support (constitution rule 2).
 */
export type IndexedSite = Omit<Searchable, "significance"> & {
  readonly id: string;
  readonly builtDisplay: string;
  /**
   * Absent until `loadSignificance()` resolves. Optional in the type on purpose:
   * anything reading it must cope with it not being there yet, and `search.ts`
   * already treats a missing field as an empty haystack contribution.
   */
  significance?: string;
};

/**
 * "" is how the generator writes an absent optional field. Restoring it to
 * `undefined` keeps these records shaped exactly like the `Site` records they
 * were projected from, so `s.state ? ... : ...` behaves identically either way.
 */
const orUndefined = (value: string): string | undefined => value || undefined;

const recordAt = (i: number): IndexedSite => ({
  id: COLUMNS.id[i],
  name: COLUMNS.name[i],
  alt: orUndefined(COLUMNS.alt[i]),
  native: orUndefined(COLUMNS.native[i]),
  country: COLUMNS.country[i],
  state: orUndefined(COLUMNS.state[i]),
  place: COLUMNS.place[i],
  tradition: COLUMNS.tradition[i],
  deity: COLUMNS.deity[i],
  /**
   * `deities` stays `[]` rather than folding to `undefined`, like `circuits`:
   * every reader spreads or maps it. `deityGroup` DOES fold, so the ordinary
   * `s.deityGroup ? … : …` test tells a record whose dedication names a figure
   * from one whose does not — the contract the untagged records rely on.
   */
  deities: COLUMNS.deities[i],
  deityGroup: orUndefined(COLUMNS.deityGroup[i]),
  dynasty: COLUMNS.dynasty[i],
  style: COLUMNS.style[i],
  circuits: COLUMNS.circuits[i],
  tier: orUndefined(COLUMNS.tier[i]),
  built: [COLUMNS.built[i][0], COLUMNS.built[i][1]],
  builtDisplay: COLUMNS.builtDisplay[i],
});

/**
 * Every record, in corpus order.
 *
 * Transposed once at module load: 1,126 objects, well under a millisecond, and
 * it buys 16.9 kB of transfer over shipping the same records row-wise — see the
 * gzip-window note in scripts/build-search-index.mjs.
 *
 * Only the array is frozen. The records are `readonly` at the type level and
 * nothing mutates them; freezing each one would add 1,126 runtime calls to the
 * critical path this module exists to shorten, and buy nothing. They must stay
 * unmutated for a second reason: `search.ts` caches each record's folded
 * haystack in a `WeakMap` keyed by object identity, so a record edited after
 * its first search would keep matching against its old text.
 */
export const SEARCH_INDEX: readonly IndexedSite[] = Object.freeze(
  Array.from({ length: RECORD_COUNT }, (_, i) => recordAt(i)),
);

/**
 * Attach the deferred `significance` text.
 *
 * `significance` is the bulk of the index — 208.7 kB gzipped of 342 kB at 2,271
 * records — and exactly one thing reads it: the full-text haystack in
 * `search.ts`, which only runs once a visitor types. Keeping it off the critical
 * path takes a list page from 342 kB to 133 kB gzipped; the rest arrives on the
 * first keystroke, by which point the reader is already looking at results
 * matched on name, place, deity and dynasty.
 *
 * Records are mutated in place rather than rebuilt, deliberately: `search.ts`
 * caches each record's folded haystack in a `WeakMap` keyed by object identity,
 * so replacing the objects would silently orphan every cached entry. The cache
 * is only ever populated by a search, and no search has run before this resolves.
 *
 * Idempotent, and safe to call from several places at once — concurrent callers
 * share the one in-flight import.
 */
let significancePromise: Promise<void> | null = null;

export const isSignificanceLoaded = (): boolean => significancePromise !== null;

export function loadSignificance(): Promise<void> {
  significancePromise ??= import("./generated/search-index-text.ts").then(({ TEXT }) => {
    if (TEXT.length !== SEARCH_INDEX.length) {
      // A stale half of the pair. Search still works on the other fields, so
      // degrade rather than throw in the visitor's face.
      console.warn(`search index: text column has ${TEXT.length} rows, expected ${SEARCH_INDEX.length}`);
      return;
    }
    SEARCH_INDEX.forEach((record, i) => { (record as { significance?: string }).significance = TEXT[i]; });
  });
  return significancePromise;
}
