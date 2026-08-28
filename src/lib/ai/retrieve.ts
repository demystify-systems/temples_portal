/**
 * Retrieval for "Ask the Atlas" (docs/ASSISTANT.md).
 *
 * This module is the whole safety story. The assistant is built as *retrieval
 * with refusal*, not as a chatbot with a knowledge base bolted on: the model
 * may only assert what these functions hand it, and when they hand it nothing
 * the correct output is a refusal (contract 2).
 *
 * Two deliberate constraints:
 *
 *   1. **Pure, and free of any data import.** Like `search.ts` and
 *      `site-utils.ts`, everything here is a function of its arguments. The
 *      corpus is passed in. That keeps `node --test` able to run this file
 *      without loading data/sites.json, and it keeps the retrieval logic
 *      testable against tiny hand-built fixtures rather than 1126 records.
 *
 *   2. **Matching is delegated to `search.ts`.** Synonym expansion, deity
 *      aliases and diacritic folding already live there and are already tested.
 *      Re-implementing them here would mean two spellings-tables drifting apart
 *      — the assistant would reach records the site's own search cannot, or
 *      worse, miss ones it can.
 *
 * The "near me" case is answered by haversine over the passed-in corpus rather
 * than the PostGIS `sites_within_km` sketched in the design doc: v1 has no
 * runtime DB (constitution rule 6), and 1126 records is nothing to scan.
 */

import { filterSites, normalise, tokenise, expandToken, type Searchable, type SearchQuery } from "../search.ts";

// ---------------------------------------------------------------------------
// the retrievable record
// ---------------------------------------------------------------------------

/** A citation carried by a record. `l` is the label, `u` the URL. */
export type Source = { readonly l: string; readonly u: string };

/** A contested circuit membership, held alongside `circuits`, never inside it. */
export type DisputedCircuit = {
  readonly circuit: string;
  readonly status: "disputed" | "unsourced";
  readonly note: string;
  readonly source?: string;
};

/**
 * The shape retrieval needs. `Site` from sites.ts is structurally assignable to
 * it; declaring it here rather than importing keeps data/sites.json out of the
 * test runner (the same trick `search.ts` plays with `Searchable`).
 */
export type AtlasRecord = Searchable & {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly builtDisplay: string;
  readonly origin?: number;
  readonly originNote?: string;
  readonly patron?: string;
  readonly status?: readonly string[];
  /** Documented history. Never blended with `story` (constitution rule 3). */
  readonly significance: string;
  /** Sthala katha — legend. Never restated as documented history. */
  readonly story?: string;
  readonly access?: string;
  readonly website?: string;
  /** Only ever present alongside a cited official `website` (rule 4 / G4). */
  readonly phone?: string;
  readonly wiki?: string;
  readonly disputedCircuits?: readonly DisputedCircuit[];
  readonly sources: readonly Source[];
  readonly verified?: string;
};

// ---------------------------------------------------------------------------
// limits
// ---------------------------------------------------------------------------

/** Records handed to the model for one question. Enough to compare, few enough to cite. */
export const DEFAULT_LIMIT = 6;
/** Ceiling on any caller-supplied limit — a prompt is a token bill. */
export const MAX_LIMIT = 12;
/** Default radius for "what is near here". */
export const DEFAULT_RADIUS_KM = 50;
export const MAX_RADIUS_KM = 500;

const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), low), high) : low;

/** A caller-supplied limit, coerced into range. Absent means the default. */
export const boundedLimit = (limit?: number): number =>
  limit === undefined ? DEFAULT_LIMIT : clamp(limit, 1, MAX_LIMIT);

// ---------------------------------------------------------------------------
// the source gate
// ---------------------------------------------------------------------------

/**
 * Constitution rule 2: no source, no field, no publish. A record with an empty
 * `sources` array cannot be quoted by the assistant at all, so it never enters
 * retrieval. `npm run validate` should make this unreachable — it is here
 * because "should" is not a guarantee, and the failure mode is an uncited claim
 * in the site's own voice.
 */
export const isSourced = (record: AtlasRecord): boolean =>
  Array.isArray(record.sources) && record.sources.length > 0;

/** Only the records that carry at least one citation. */
export const sourced = <T extends AtlasRecord>(corpus: readonly T[]): readonly T[] =>
  corpus.filter(isSourced);

// ---------------------------------------------------------------------------
// ranking
// ---------------------------------------------------------------------------

/** Folded text of the naming fields only — used to rank, never to match. */
const namesOf = (record: AtlasRecord): string =>
  normalise([record.name, record.alt ?? "", record.native ?? ""].join(" "));

const placesOf = (record: AtlasRecord): string =>
  normalise([record.place, record.state ?? "", record.country].join(" "));

const hits = (haystack: string, tokens: readonly string[]): boolean =>
  tokens.length > 0 && tokens.every((token) => expandToken(token).some((variant) => haystack.includes(variant)));

/**
 * How directly a record answers the query. `filterSites` has already decided
 * *whether* it matches; this only decides the order in which matches are shown.
 *
 * A name match outranks a place match outranks a match buried in `significance`,
 * because "Meenakshi" should reach the Meenakshi temple before it reaches the
 * dozen records whose history paragraph mentions it.
 */
export const relevance = (record: AtlasRecord, query: string): number => {
  const tokens = tokenise(query);
  if (tokens.length === 0) return 0;
  if (normalise(record.name) === normalise(query)) return 4;
  if (hits(namesOf(record), tokens)) return 3;
  if (hits(placesOf(record), tokens)) return 2;
  return 1;
};

// ---------------------------------------------------------------------------
// retrieval
// ---------------------------------------------------------------------------

export type RetrievalReason = "ok" | "blank-query" | "no-match";

export type Retrieval<T extends AtlasRecord = AtlasRecord> = {
  readonly query: string;
  readonly records: readonly T[];
  /** True when the model must refuse. This is a success state, not an error. */
  readonly empty: boolean;
  readonly reason: RetrievalReason;
  /** Matches found before the limit was applied — lets the answer say "and N more". */
  readonly total: number;
};

const emptyResult = <T extends AtlasRecord>(query: string, reason: RetrievalReason): Retrieval<T> => ({
  query,
  records: [],
  empty: true,
  reason,
  total: 0,
});

/**
 * Records answering a question, most relevant first.
 *
 * Returns **empty rather than a weak guess**. There is no widening fallback: if
 * every word of the query (in any known spelling) does not appear in a record,
 * the corpus does not answer the question and the assistant must say so. A
 * "closest match" here would be indistinguishable, to a pilgrim, from an answer.
 */
export function retrieve<T extends AtlasRecord>(
  corpus: readonly T[],
  query: string,
  facets: SearchQuery = {},
  limit?: number,
): Retrieval<T> {
  const trimmed = (query ?? "").trim();
  const hasFacet = Object.values(facets).some((value) => Boolean(value));
  if (!trimmed && !hasFacet) return emptyResult<T>(trimmed, "blank-query");

  const pool = sourced(corpus);
  const matched = filterSites(pool, { ...facets, q: trimmed });
  if (matched.length === 0) return emptyResult<T>(trimmed, "no-match");

  // Stable: equal relevance keeps corpus order, which is roughly prominence.
  const ranked = matched
    .map((record, index) => ({ record, score: relevance(record, trimmed), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.record);

  return {
    query: trimmed,
    records: ranked.slice(0, boundedLimit(limit)),
    empty: false,
    reason: "ok",
    total: matched.length,
  };
}

/** One record by id, or null. Unsourced records are invisible here too. */
export const retrieveById = <T extends AtlasRecord>(corpus: readonly T[], id: string): T | null =>
  corpus.find((record) => record.id === id && isSourced(record)) ?? null;

// ---------------------------------------------------------------------------
// proximity
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in km. Rounded to 1 dp: the corpus is not surveyed to metres. */
export function distanceKm(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

export type NearbyHit<T extends AtlasRecord = AtlasRecord> = { readonly record: T; readonly km: number };

/**
 * Sourced records within `radiusKm` of a point, nearest first, excluding the
 * origin record itself when `excludeId` names one.
 */
export function nearby<T extends AtlasRecord>(
  corpus: readonly T[],
  origin: { readonly lat: number; readonly lng: number },
  options: { readonly radiusKm?: number; readonly limit?: number; readonly excludeId?: string } = {},
): readonly NearbyHit<T>[] {
  const radius = clamp(options.radiusKm ?? DEFAULT_RADIUS_KM, 1, MAX_RADIUS_KM);
  return sourced(corpus)
    .filter((record) => record.id !== options.excludeId)
    .map((record) => ({ record, km: distanceKm(origin, record) }))
    .filter((hit) => hit.km <= radius)
    .sort((a, b) => a.km - b.km)
    .slice(0, boundedLimit(options.limit));
}

// ---------------------------------------------------------------------------
// circuits
// ---------------------------------------------------------------------------

export type CircuitMembership<T extends AtlasRecord = AtlasRecord> = {
  readonly record: T;
  /** True when the record's own `disputedCircuits` contests this membership. */
  readonly contested: boolean;
  readonly dispute: DisputedCircuit | null;
};

/**
 * Every sourced record claiming `circuit`, each flagged with whether that claim
 * is contested by its own citation (guardrail G10).
 *
 * A contested member is *listed*, never silently dropped and never quietly
 * ranked as canonical: rival claimants dispute a slot (Baidyanath Deoghar and
 * Vaijnath Parli over one Jyotirlinga) and both sides carry an entry. The
 * assistant's job is to report the disagreement, not to settle it.
 */
export function circuitMembership<T extends AtlasRecord>(
  corpus: readonly T[],
  circuit: string,
): readonly CircuitMembership<T>[] {
  const wanted = normalise(circuit);
  if (!wanted) return [];
  return sourced(corpus)
    .filter((record) => (record.circuits ?? []).some((c) => normalise(c) === wanted))
    .map((record) => {
      const dispute = (record.disputedCircuits ?? []).find((d) => normalise(d.circuit) === wanted) ?? null;
      return { record, contested: dispute !== null, dispute };
    });
}

/** Distinct circuit names present in the corpus, most-claimed first. */
export function circuitNames(corpus: readonly AtlasRecord[]): readonly string[] {
  const tally = new Map<string, number>();
  for (const record of sourced(corpus)) {
    for (const circuit of record.circuits ?? []) tally.set(circuit, (tally.get(circuit) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}
