/**
 * The prose half of a record, fetched for ONE record when it is selected.
 *
 * The detail rail renders `significance`, `story`, `access`, `sources`,
 * `website`, `phone`, `wiki`, `patron` and `originNote`. Those fields are the
 * bulk of the corpus — 778.5 kB gzipped across 3,031 records — and the rail
 * shows exactly one record at a time. Bundling them all so that one can be read
 * is the trade this module exists to reverse: 606 bytes on selection instead of
 * 778 kB on load.
 *
 * The files are written at build time by scripts/build-map-artefacts.mjs into
 * `public/r/<id>.json`, so they are static assets on the CDN beside the HTML —
 * no database, no cold start, no key, no rate limit, and they keep working with
 * Supabase switched off entirely (constitution rule 6).
 */

export type Source = { readonly l: string; readonly u: string };

/** Exactly the fields `build-map-artefacts.mjs` writes. All optional: a record omits what it has not sourced (rule 2). */
export type RecordDetail = {
  readonly significance?: string;
  readonly story?: string;
  readonly access?: string;
  readonly website?: string;
  readonly phone?: string;
  readonly wiki?: string;
  readonly patron?: string;
  readonly origin?: number;
  readonly originNote?: string;
  readonly status?: readonly string[];
  readonly sources?: readonly Source[];
  /** The `verified` stamp. A METHOD and a date, not a human verification — read it through src/lib/verification.ts. */
  readonly verified?: string;
};

/**
 * Cache by id. A pilgrim comparing three temples clicks between them repeatedly,
 * and a record's prose cannot change within a page view — the files are
 * immutable per deploy. `null` is cached too, so a genuinely missing record is
 * not re-fetched on every click.
 */
const cache = new Map<string, RecordDetail | null>();
/** In-flight requests, so double-clicking a mark issues one fetch, not two. */
const inFlight = new Map<string, Promise<RecordDetail | null>>();

/**
 * The detail for one record, or `null` if it could not be loaded.
 *
 * Never throws. A failed fetch degrades the rail to what the map index already
 * holds — name, place, dates, tradition — which is a thinner panel, not a broken
 * one. Refusing to render anything because the prose is missing would be worse
 * than rendering the half we have.
 */
export function loadRecord(id: string, signal?: AbortSignal): Promise<RecordDetail | null> {
  const hit = cache.get(id);
  if (hit !== undefined) return Promise.resolve(hit);

  const existing = inFlight.get(id);
  if (existing) return existing;

  const request = fetch(`/r/${encodeURIComponent(id)}.json`, { signal })
    .then((response) => (response.ok ? (response.json() as Promise<RecordDetail>) : null))
    .then((detail) => {
      cache.set(id, detail);
      return detail;
    })
    .catch(() => {
      // An aborted fetch is a selection the reader has already moved on from,
      // not a failure — and caching `null` for it would make the record
      // permanently prose-less for the rest of the page view.
      if (!signal?.aborted) cache.set(id, null);
      return null;
    })
    .finally(() => { inFlight.delete(id); });

  inFlight.set(id, request);
  return request;
}

/** Test seam: lets a test prime the cache without a network. */
export const primeRecordCache = (id: string, detail: RecordDetail | null): void => { cache.set(id, detail); };
