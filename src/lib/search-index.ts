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
export type IndexedSite = Searchable & {
  readonly id: string;
  readonly builtDisplay: string;
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
  dynasty: COLUMNS.dynasty[i],
  style: COLUMNS.style[i],
  circuits: COLUMNS.circuits[i],
  tier: orUndefined(COLUMNS.tier[i]),
  built: [COLUMNS.built[i][0], COLUMNS.built[i][1]],
  builtDisplay: COLUMNS.builtDisplay[i],
  significance: COLUMNS.significance[i],
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
 * NEXT STEP, once this is wired into SiteFilters and measured in a real build.
 *
 * `significance` is 107.5 kB of the 183.6 kB, and it is read by exactly one
 * thing: the full-text haystack in `search.ts`, which only runs when the visitor
 * types. Splitting it into its own chunk that a list page `import()`s on the
 * first keystroke leaves 75.9 kB gzipped on the critical path — a 75% cut
 * against today's 309 kB — while still searching the full, untruncated text.
 * That needs a change in `SiteFilters.tsx`, which is why it is not done here.
 */
