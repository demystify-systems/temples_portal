/**
 * Shaping the assistant's response payload — pure, and deliberately so.
 *
 * An answer that only names temples in prose is a dead end: the reader is told
 * a record exists and then left to go and find it. This module turns the
 * records the *tools actually returned* into linkable result cards, so an
 * answer becomes a doorway into the atlas.
 *
 * The load-bearing rule is in the second sentence above, and it is the same one
 * that governs citations (`docs/ASSISTANT.md`, contract 1):
 *
 *   **A URL is only ever built from a record the tools returned.**
 *
 * Never from the model's text. Parsing an entity name out of generated prose
 * and turning it into `/site/<slug>` would produce a link that looks exactly
 * like a citation, points at a page that may describe a different temple, and
 * carries the site's authority while doing it. That is a fabricated citation
 * wearing a URL. The only input to `siteUrl` in this file is `record.id`.
 *
 * Pure and corpus-free for the same reason as `retrieve.ts` and `tools.ts`: the
 * corpus is a parameter, so every rule below is testable against a handful of
 * fixtures instead of 1126 records.
 */

import { normalise } from "../search.ts";
import { slugify } from "../site-utils.ts";
import type { AtlasRecord, DisputedCircuit, Source } from "./retrieve.ts";

// ---------------------------------------------------------------------------
// limits
// ---------------------------------------------------------------------------

/**
 * Cards shown under one answer. The panel is read on a phone in a queue; past
 * half a dozen the cards stop being a doorway and start being a second search
 * results page. The rest are honestly counted by `more`, not silently dropped.
 */
export const MAX_RESULT_CARDS = 6;

/** Where "and N more" goes. The gazetteer holds every record, filterable. */
export const GAZETTEER_URL = "/sites";

/**
 * Shortest record name considered a "mention" when reconciling prose against
 * the cited set. Short names ("Sun", "Dham") collide with ordinary words and
 * would drop good sentences; the check must be conservative to be useful.
 */
export const MIN_MENTION_CHARS = 6;

/** Last-resort text when reconciliation removes every sentence of an answer. */
export const NOTHING_LEFT =
  "I don't have a sourced answer for that. Tirtha Atlas only answers from its cited records.";

// ---------------------------------------------------------------------------
// urls — the only place a link is built, and only ever from a record
// ---------------------------------------------------------------------------

/** The canonical page for a record. The argument is an id, never a name. */
export const siteUrl = (id: string): string => `/site/${encodeURIComponent(id)}`;

/**
 * Circuit and dynasty pages are keyed by `slugify` of the recorded name — the
 * same function `generateStaticParams` uses in `circuit/[slug]` and
 * `dynasty/[slug]`. Reusing it is what guarantees the link resolves; a second
 * slug implementation here would drift and start 404ing on the first name with
 * an ampersand in it.
 */
export const circuitUrl = (circuit: string): string => `/circuit/${slugify(circuit)}`;
export const dynastyUrl = (dynasty: string): string => `/dynasty/${slugify(dynasty)}`;

// ---------------------------------------------------------------------------
// the result card
// ---------------------------------------------------------------------------

export type DeepLink = { readonly name: string; readonly url: string };

/**
 * A circuit membership as the card shows it.
 *
 * `contested` is not decoration. A record that carries a `disputedCircuits`
 * entry for this circuit is claimed by some sources and not others, and the
 * site page says so on the chip itself. An answer that quietly presented the
 * same membership as settled — because it came through the assistant rather
 * than through the page — would be the atlas contradicting itself in the one
 * direction that matters (guardrail G10).
 */
export type ResultCircuit = DeepLink & {
  readonly contested: boolean;
  readonly status?: DisputedCircuit["status"];
  readonly note?: string;
  readonly source?: string;
};

export type AnswerResult = {
  readonly id: string;
  readonly name: string;
  readonly native?: string;
  readonly place: string;
  readonly state?: string;
  readonly country: string;
  readonly builtDisplay: string;
  readonly tradition: string;
  /** `/site/<id>`. Built from the id, never from anything the model wrote. */
  readonly url: string;
  readonly dynasty?: DeepLink;
  readonly circuits: readonly ResultCircuit[];
  /** True when any membership on this card is contested. */
  readonly contested: boolean;
};

const deepLink = (name: string | undefined, toUrl: (value: string) => string): DeepLink | undefined => {
  if (!name) return undefined;
  const url = toUrl(name);
  // An unsluggable name (punctuation only) would produce `/dynasty/`, which is
  // not a page. No link is better than a link to the wrong place.
  return url.endsWith("/") ? undefined : { name, url };
};

/**
 * Circuits as links, contested memberships included and flagged.
 *
 * A dispute whose circuit is absent from `circuits` still appears: the record
 * is claimed for that circuit by someone, and the site page lists it under
 * "Contested attributions". Hiding it here would be the assistant resolving a
 * disagreement the atlas deliberately leaves open.
 */
export const circuitsOf = (record: AtlasRecord): readonly ResultCircuit[] => {
  const disputes = record.disputedCircuits ?? [];
  const disputeFor = (circuit: string): DisputedCircuit | undefined =>
    disputes.find((d) => d.circuit === circuit);

  const names = [
    ...(record.circuits ?? []),
    ...disputes.map((d) => d.circuit).filter((c) => !(record.circuits ?? []).includes(c)),
  ];

  const seen = new Set<string>();
  const out: ResultCircuit[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const link = deepLink(name, circuitUrl);
    if (!link) continue;
    const dispute = disputeFor(name);
    out.push({
      ...link,
      contested: Boolean(dispute),
      ...(dispute
        ? {
            status: dispute.status,
            note: dispute.note,
            ...(dispute.source ? { source: dispute.source } : {}),
          }
        : {}),
    });
  }
  return out;
};

/** One record as a card. Every field is copied from the record, none inferred. */
export const toResult = (record: AtlasRecord): AnswerResult => {
  const circuits = circuitsOf(record);
  const dynasty = deepLink(record.dynasty, dynastyUrl);
  return {
    id: record.id,
    name: record.name,
    ...(record.native ? { native: record.native } : {}),
    place: record.place,
    ...(record.state ? { state: record.state } : {}),
    country: record.country,
    builtDisplay: record.builtDisplay,
    tradition: record.tradition,
    url: siteUrl(record.id),
    ...(dynasty ? { dynasty } : {}),
    circuits,
    contested: circuits.some((c) => c.contested),
  };
};

// ---------------------------------------------------------------------------
// citations
// ---------------------------------------------------------------------------

export type Citation = {
  readonly id: string;
  readonly name: string;
  readonly place: string;
  readonly url: string;
  readonly sources: readonly Source[];
};

/**
 * Records the tools returned, in first-seen order, each appearing once.
 *
 * Order is retrieval order — most relevant first — and is preserved through
 * de-duplication so the cap below cuts the least relevant, not an arbitrary one.
 */
export const dedupe = <T extends AtlasRecord>(records: readonly T[]): readonly T[] => {
  const seen = new Map<string, T>();
  for (const record of records) if (!seen.has(record.id)) seen.set(record.id, record);
  return [...seen.values()];
};

/**
 * Citations come from the records the tools actually returned, never from the
 * model's text. A model cannot fabricate a citation it was never given, so this
 * is the mechanism that makes contract 1 true rather than merely requested.
 */
export const toCitations = (records: readonly AtlasRecord[]): readonly Citation[] =>
  dedupe(records).map((record) => ({
    id: record.id,
    name: record.name,
    place: [record.place, record.state, record.country].filter(Boolean).join(", "),
    url: siteUrl(record.id),
    sources: record.sources,
  }));

// ---------------------------------------------------------------------------
// the cap, and an honest count of what it hid
// ---------------------------------------------------------------------------

export type MoreLink = { readonly count: number; readonly url: string };

export type ShapedResults = {
  readonly results: readonly AnswerResult[];
  /** Distinct cited records, before the cap. */
  readonly total: number;
  /** Null when nothing was hidden — never a "0 more" link. */
  readonly more: MoreLink | null;
};

export const shapeResults = (
  cited: readonly AtlasRecord[],
  cap: number = MAX_RESULT_CARDS,
): ShapedResults => {
  const unique = dedupe(cited);
  const ceiling = Math.max(0, Math.trunc(Number.isFinite(cap) ? cap : MAX_RESULT_CARDS));
  const shown = unique.slice(0, ceiling);
  const hidden = unique.length - shown.length;
  return {
    results: shown.map(toResult),
    total: unique.length,
    more: hidden > 0 ? { count: hidden, url: GAZETTEER_URL } : null,
  };
};

// ---------------------------------------------------------------------------
// prose ↔ cards: they must not contradict each other
// ---------------------------------------------------------------------------

/**
 * Sentence-ish segments, each keeping its own terminator and trailing newlines.
 * Devanagari danda and double danda are terminators too — the reply comes back
 * in the asker's script, and splitting a Hindi answer on full stops alone would
 * treat a whole paragraph as one sentence.
 */
const SEGMENTS = /[^.!?।॥…\n]+[.!?।॥…]*\n*|\n+/gu;

export const segmentsOf = (text: string): readonly string[] => text.match(SEGMENTS) ?? [];

/** Folded text with sentinel spaces, so `includes` is a whole-word test. */
const padded = (text: string): string => ` ${normalise(text)} `;

const mentions = (haystack: string, foldedName: string): boolean =>
  haystack.includes(` ${foldedName} `);

/**
 * A cited record's own labelled fields, folded. Short, factual values only —
 * the ones the prompt hands over as fields the model may quote. Free-prose
 * fields are excluded on purpose; see `uncitedMentions`.
 */
const identityText = (record: AtlasRecord): string =>
  normalise(
    [
      record.name, record.alt ?? "", record.native ?? "",
      record.place, record.state ?? "", record.country,
      record.deity, record.dynasty, record.style,
      record.patron ?? "", record.tier ?? "", record.builtDisplay,
      ...(record.circuits ?? []),
    ].join(" "),
  );

export type Mention = { readonly id: string; readonly name: string };

/**
 * Records named in the prose that the tools never returned.
 *
 * This is a *detector*, and its output is never turned into a link — that is
 * the whole distinction this module rests on. Reading a name out of generated
 * text tells you the model said something; it does not tell you the record
 * exists, and it certainly does not license a URL.
 *
 * Deliberately conservative, because the remedy (below) is destructive:
 *
 *   - names shorter than `MIN_MENTION_CHARS` are ignored;
 *   - a candidate whose folded name appears anywhere in a cited record's own
 *     labelled fields is skipped as ambiguous. "Somnath" in an answer that
 *     cites Somnath Temple is that temple being discussed, not a second record
 *     being smuggled in — and Ratu Boko's DEITY field really does read
 *     "Avalokitesvara (the Abhayagiri Vihara)", which is a different site from
 *     the Sri Lankan record of that name. A sentence quoting a cited record's
 *     own field is grounded, whatever else shares the words.
 *
 * `significance` and `story` are deliberately NOT part of that guard. They are
 * free prose and routinely mention other temples; whitelisting them would let a
 * name the model lifted from one record's history paragraph pass as an assertion
 * about a record that was never retrieved — a claim with no card behind it,
 * which is the mismatch this check exists to prevent.
 */
export const uncitedMentions = (
  prose: string,
  cited: readonly AtlasRecord[],
  corpus: readonly AtlasRecord[],
): readonly Mention[] => {
  const haystack = padded(prose);
  if (haystack.trim().length === 0) return [];

  const citedIds = new Set(cited.map((record) => record.id));
  const citedText = cited.map(identityText).join(" | ");

  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const record of corpus) {
    if (citedIds.has(record.id) || seen.has(record.id)) continue;
    const folded = normalise(record.name);
    if (folded.length < MIN_MENTION_CHARS) continue;
    if (citedText.includes(folded)) continue;
    if (!mentions(haystack, folded)) continue;
    seen.add(record.id);
    out.push({ id: record.id, name: record.name });
  }
  return out;
};

export type Reconciled = {
  readonly text: string;
  /** Names of records the prose asserted but the tools never returned. */
  readonly dropped: readonly string[];
  /** True when nothing survived — the answer was entirely unsupported. */
  readonly emptied: boolean;
};

/**
 * Make the prose and the cards agree, by removing the prose that disagrees.
 *
 * The alternative — shipping the sentence and adding a card for the temple it
 * names — is the failure this whole module exists to prevent: it would mean
 * building a link from generated text. The alternative after that, shipping
 * the sentence with no card, leaves the reader with a claim that has no source
 * and no page, which is precisely the "plausible-sounding stranger" the
 * refusal contract rules out.
 *
 * So the claim goes. It costs a sentence in a rare case; the other two options
 * cost the guarantee.
 */
export const reconcile = (
  prose: string,
  cited: readonly AtlasRecord[],
  corpus: readonly AtlasRecord[],
): Reconciled => {
  const flagged = uncitedMentions(prose, cited, corpus);
  if (flagged.length === 0) return { text: prose, dropped: [], emptied: false };

  const needles = flagged.map((mention) => normalise(mention.name));
  const kept = segmentsOf(prose).filter((segment) => {
    const haystack = padded(segment);
    return !needles.some((needle) => mentions(haystack, needle));
  });

  const text = kept
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, dropped: flagged.map((mention) => mention.name), emptied: text.length === 0 };
};

// ---------------------------------------------------------------------------
// the payload
// ---------------------------------------------------------------------------

export type AnswerPayload = {
  readonly answer: string;
  readonly citations: readonly Citation[];
  readonly results: readonly AnswerResult[];
  readonly resultsTotal: number;
  readonly more: MoreLink | null;
  /** A refusal: no cards, no citations, nothing asserted. */
  readonly refused: boolean;
  /** Records the prose named that the tools never returned. Empty is the norm. */
  readonly dropped: readonly string[];
};

/** A refusal is a correct answer (contract 2) — and it never carries cards. */
export const refusalPayload = (
  answer: string,
  dropped: readonly string[] = [],
): AnswerPayload => ({
  answer,
  citations: [],
  results: [],
  resultsTotal: 0,
  more: null,
  refused: true,
  dropped,
});

export type AnswerInput = {
  /** The model's prose. */
  readonly answer: string;
  /** The records the TOOLS returned — the only source of cards and citations. */
  readonly cited: readonly AtlasRecord[];
  /** Checked against for prose that names a record the tools never returned. */
  readonly corpus?: readonly AtlasRecord[];
  /** Force the refusal shape regardless of what was cited. */
  readonly refused?: boolean;
  readonly cap?: number;
  /** Refusal wording to fall back on when reconciliation empties the answer. */
  readonly refusalText?: string;
};

/**
 * The whole response, shaped.
 *
 * Nothing cited means nothing was asserted, so it is a refusal even when the
 * model produced prose: cards and citations both come from the tool outcomes,
 * and with an empty outcome there is nothing honest to show beside the text.
 */
export function buildAnswer(input: AnswerInput): AnswerPayload {
  const unique = dedupe(input.cited);
  if (input.refused || unique.length === 0) return refusalPayload(input.answer);

  const { text, dropped, emptied } = reconcile(input.answer, unique, input.corpus ?? unique);
  if (emptied) return refusalPayload(input.refusalText ?? NOTHING_LEFT, dropped);

  const shaped = shapeResults(unique, input.cap ?? MAX_RESULT_CARDS);
  return {
    answer: text,
    citations: toCitations(unique),
    results: shaped.results,
    resultsTotal: shaped.total,
    more: shaped.more,
    refused: false,
    dropped,
  };
}
