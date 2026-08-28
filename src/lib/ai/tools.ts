/**
 * Tool definitions and executors for "Ask the Atlas".
 *
 * These five tools are the assistant's *only* window onto the world. The model
 * has no other way to learn a fact about a site, and everything they return
 * carries the record's citations with it, so an answer can always be traced
 * back to a source (contract 1).
 *
 * The design principle that matters most here is that **absence is returned as
 * data**. A tool that returns nothing invites the model to fill the silence
 * from its weights; a tool that returns `missing: ["phone"]` and a sentence
 * saying why gives it something true to say instead. `contactInfo` is the
 * clearest case: "we do not list unverified numbers" is the product working
 * correctly, not a gap to be papered over.
 *
 * Pure and corpus-free, for the same reason as `retrieve.ts` — the corpus is a
 * parameter, so the whole surface is testable against small fixtures.
 */

import type { SearchQuery } from "../search.ts";
import {
  retrieve, retrieveById, nearby, circuitMembership, boundedLimit,
  DEFAULT_RADIUS_KM, isSourced,
  type AtlasRecord, type Source, type DisputedCircuit,
} from "./retrieve.ts";
import { siteUrl } from "./answer.ts";

// ---------------------------------------------------------------------------
// the notes — exported so tests pin the exact wording the pilgrim sees
// ---------------------------------------------------------------------------

/**
 * The contact note in the spec, verbatim. Rule 4: phones come only from a site's
 * own official website (cited) or a dated call-verification log. Anything else
 * — a listing, a blog, a plausible-looking number — is not publishable, and
 * silence is the honest answer.
 */
export const NO_PHONE_NOTE =
  "No official phone is published for this site. We do not list unverified numbers.";

export const PHONE_NOTE =
  "This number is published on the site's own official website, cited below. Quote it exactly as given; never reformat or complete it.";

/**
 * Defence in depth for rule 4 / G4: `phone` may only exist alongside a cited
 * official `website`. If a record ever violates that, the number is withheld
 * rather than served.
 */
export const UNBACKED_PHONE_NOTE =
  "A phone number is recorded for this site without a cited official website, so it is withheld. We do not list unverified numbers.";

export const NOT_FOUND_NOTE =
  "No record with that id exists in the atlas. Do not answer from general knowledge — say the atlas has no entry for it.";

export const NO_MATCH_NOTE =
  "The atlas has no record matching that query. This is a complete answer: say so plainly and do not substitute general knowledge.";

export const CONTESTED_NOTE =
  "Some memberships below are contested by their own sources. Report them as contested; never present a contested claim as the canonical one.";

export const GAPS_NOTE =
  "Fields listed under `missing` are absent from the record. Report them as not recorded. Never infer, estimate or fill them.";

// ---------------------------------------------------------------------------
// argument coercion — tool arguments arrive as model-authored JSON
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const num = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** A model's `arguments` string, parsed defensively. Malformed JSON means no args. */
export const parseArgs = (raw: unknown): Args => {
  if (raw && typeof raw === "object") return raw as Args;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Args) : {};
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// record rendering — every shape below carries its sources
// ---------------------------------------------------------------------------

/** Optional fields whose absence a pilgrim would notice. Drives "no tier inflation". */
const REPORTABLE_FIELDS = ["native", "patron", "origin", "story", "access", "website", "phone"] as const;

/**
 * Which reportable fields this record does not hold.
 *
 * A compact record's gaps are reported *as gaps* (contract 5). Without this the
 * model sees a short record and, being a language model, rounds it up into a
 * confident-sounding paragraph.
 */
export const gapsOf = (record: AtlasRecord): readonly string[] =>
  REPORTABLE_FIELDS.filter((field) => {
    const value = (record as unknown as Record<string, unknown>)[field];
    return value === undefined || value === null || value === "";
  });

export type BriefRecord = {
  readonly id: string;
  readonly name: string;
  readonly native?: string;
  readonly place: string;
  readonly state?: string;
  readonly country: string;
  readonly tradition: string;
  readonly deity: string;
  readonly built: string;
  /**
   * The record's own page in the atlas, `/site/<id>`.
   *
   * It travels with the result so the *interface* can turn an answer into a
   * doorway — the card under the reply links here. It is built from the id, so
   * a link can only ever exist for a record a tool really returned. The model
   * is told (prompt rule 7) never to write it into its prose: a URL typed by a
   * model is a guess wearing the shape of a citation.
   */
  readonly url: string;
  readonly sources: readonly Source[];
};

/** The list-view shape. Short, but never sourceless. */
export const brief = (record: AtlasRecord): BriefRecord => ({
  id: record.id,
  name: record.name,
  ...(record.native ? { native: record.native } : {}),
  place: record.place,
  ...(record.state ? { state: record.state } : {}),
  country: record.country,
  tradition: record.tradition,
  deity: record.deity,
  built: record.builtDisplay,
  url: siteUrl(record.id),
  sources: record.sources,
});

export type FullRecord = BriefRecord & {
  readonly dynasty: string;
  readonly patron?: string;
  readonly style: string;
  readonly circuits: readonly string[];
  readonly disputedCircuits: readonly DisputedCircuit[];
  readonly tier?: string;
  /** Documented history. May be stated as fact. */
  readonly significance: string;
  /** Sthala katha — legend. May only be reported as what tradition holds. */
  readonly story?: string;
  readonly access?: string;
  readonly website?: string;
  readonly missing: readonly string[];
  readonly note: string;
};

/**
 * The detail shape. `significance` and `story` stay separate keys with separate
 * meanings — they are never concatenated, here or anywhere downstream
 * (constitution rule 3).
 *
 * `phone` is deliberately absent: contact details go through `contactInfo`,
 * which is the one place the website-backing rule is enforced.
 */
export const full = (record: AtlasRecord): FullRecord => ({
  ...brief(record),
  dynasty: record.dynasty,
  ...(record.patron ? { patron: record.patron } : {}),
  style: record.style,
  circuits: record.circuits ?? [],
  disputedCircuits: record.disputedCircuits ?? [],
  ...(record.tier ? { tier: record.tier } : {}),
  significance: record.significance,
  ...(record.story ? { story: record.story } : {}),
  ...(record.access ? { access: record.access } : {}),
  ...(record.website ? { website: record.website } : {}),
  missing: gapsOf(record),
  note: GAPS_NOTE,
});

// ---------------------------------------------------------------------------
// tool definitions (OpenAI-shaped, which is what Sarvam speaks)
// ---------------------------------------------------------------------------

export type ToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
};

const object = (properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  ...(required.length ? { required: [...required] } : {}),
  additionalProperties: false,
});

const string_ = (description: string) => ({ type: "string", description });
const integer_ = (description: string, min: number, max: number) =>
  ({ type: "integer", description, minimum: min, maximum: max });

export const TOOL_NAMES = ["findSites", "siteDetail", "contactInfo", "nearbySites", "circuitMembers"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOLS: readonly ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "findSites",
      description:
        "Search the atlas for sacred sites. Returns only records that exist in the corpus, each with its citations. " +
        "An empty result means the atlas has no such record — say so; do not answer from general knowledge.",
      parameters: object(
        {
          query: string_("Search terms in English: name, deity, place, dynasty or style. Transliteration variants are handled."),
          tradition: string_("Optional exact filter: Hindu, Buddhist, Jain or Sikh."),
          country: string_("Optional exact country name as recorded, e.g. India, Nepal, Cambodia."),
          state: string_("Optional exact state or province name as recorded."),
          era: string_("Optional era: Ancient, Early medieval, High medieval, Late medieval, Early modern, Modern."),
          circuit: string_("Optional exact circuit name, e.g. Jyotirlinga, Char Dham, Divya Desam."),
          deity: string_("Optional principal deity: Shiva, Vishnu, Devi / Shakti, Murugan / Kartikeya, Ganesha, Hanuman, Surya, Buddha, Mahavira / Tirthankaras, Sikh Gurus."),
          limit: integer_("How many records to return.", 1, 12),
        },
        ["query"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "siteDetail",
      description:
        "Full record for one site id, including its documented history (`significance`) and, separately, its legend " +
        "(`story`). Never merge the two: `story` is sthala katha and may only be reported as what tradition holds. " +
        "`missing` lists fields the record does not hold — report those as not recorded.",
      parameters: object({ id: string_("The site id, exactly as returned by findSites.") }, ["id"]),
    },
  },
  {
    type: "function",
    function: {
      name: "contactInfo",
      description:
        "Official website, phone and access notes for one site — and, explicitly, which of them are absent. " +
        "A phone number is published only when the site's own official website carries it. If `phone` is null there " +
        "is no number to give: say so. Never compose, complete, guess or reformat a number.",
      parameters: object({ id: string_("The site id, exactly as returned by findSites.") }, ["id"]),
    },
  },
  {
    type: "function",
    function: {
      name: "nearbySites",
      description:
        "Sourced sites within a radius of a point, nearest first. Give either a site id to search around, or an " +
        "explicit lat/lng. Distances are great-circle kilometres, not travel distance.",
      parameters: object({
        id: string_("Search around this site (it is excluded from the results)."),
        lat: { type: "number", description: "Latitude in decimal degrees, if no id is given.", minimum: -90, maximum: 90 },
        lng: { type: "number", description: "Longitude in decimal degrees, if no id is given.", minimum: -180, maximum: 180 },
        radiusKm: integer_("Search radius in kilometres.", 1, 500),
        limit: integer_("How many records to return.", 1, 12),
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "circuitMembers",
      description:
        "Members of a pilgrimage circuit (Jyotirlinga, Char Dham, Shakti Peetha, Divya Desam and others). " +
        "Memberships contested by their own sources are returned with `contested: true` and the dispute's note and " +
        "citation. Report a contested claim as contested; never rank it as the canonical member.",
      parameters: object(
        {
          circuit: string_("Exact circuit name as recorded, e.g. Jyotirlinga."),
          limit: integer_("How many records to return.", 1, 12),
        },
        ["circuit"],
      ),
    },
  },
];

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

export type ContactField = { readonly value: string; readonly source: string };

export type ContactResult = {
  readonly site: string;
  readonly name?: string;
  /** The record's page in the atlas. Absent when no such record exists. */
  readonly url?: string;
  readonly website: ContactField | null;
  readonly phone: ContactField | null;
  readonly access: ContactField | null;
  readonly missing: readonly string[];
  readonly note: string;
  readonly sources?: readonly Source[];
};

export type CircuitMemberResult = BriefRecord & {
  readonly contested: boolean;
  readonly disputeStatus?: DisputedCircuit["status"];
  readonly disputeNote?: string;
  readonly disputeSource?: string;
};

/**
 * What a tool hands back: the JSON the model sees, plus the records that JSON
 * drew on. The route uses `cited` to render citation chips beside the answer,
 * so a citation can never be something the model typed.
 */
export type ToolOutcome = {
  readonly result: unknown;
  readonly cited: readonly AtlasRecord[];
};

// ---------------------------------------------------------------------------
// executors
// ---------------------------------------------------------------------------

const findSites = <T extends AtlasRecord>(corpus: readonly T[], args: Args): ToolOutcome => {
  const facets: SearchQuery = {
    tradition: str(args.tradition), country: str(args.country), state: str(args.state),
    era: str(args.era), circuit: str(args.circuit), tier: str(args.tier), deity: str(args.deity),
  };
  const found = retrieve(corpus, str(args.query) ?? "", facets, num(args.limit));
  if (found.empty) {
    return { result: { count: 0, records: [], note: NO_MATCH_NOTE, reason: found.reason }, cited: [] };
  }
  // `fuzzy` is true only when NOTHING matched the query as typed and the records
  // were reached by transliteration folding — "jaganath" finding Jagannath. The
  // model must be told, or it answers a misspelling with silent confidence and
  // the reader never learns the spelling we actually hold. This is a fact about
  // the retrieval, not about the temple, so it belongs in the note rather than
  // in any record.
  const notes = [
    found.total > found.records.length
      ? `${found.total} records match; the ${found.records.length} most relevant are shown.`
      : "",
    found.fuzzy
      ? "No record matched the query as spelled; these were found by transliteration. " +
        "Say which spelling the atlas holds, so the reader can search it directly."
      : "",
  ].filter(Boolean);

  return {
    result: {
      count: found.records.length,
      total: found.total,
      records: found.records.map(brief),
      ...(found.fuzzy ? { matchedByTransliteration: true } : {}),
      ...(notes.length ? { note: notes.join(" ") } : {}),
    },
    cited: found.records,
  };
};

const siteDetail = <T extends AtlasRecord>(corpus: readonly T[], args: Args): ToolOutcome => {
  const record = retrieveById(corpus, str(args.id) ?? "");
  if (!record) return { result: { found: false, id: str(args.id) ?? null, note: NOT_FOUND_NOTE }, cited: [] };
  return { result: { found: true, ...full(record) }, cited: [record] };
};

/**
 * Contact details, with absence returned as data.
 *
 * Three things this must never do: invent a number, reformat the one it has, or
 * serve a number that no cited official website backs. The last case should be
 * impossible — the data gate enforces it — so it is handled by withholding,
 * which fails safe if the gate ever slips.
 */
const contactInfo = <T extends AtlasRecord>(corpus: readonly T[], args: Args): ToolOutcome => {
  const id = str(args.id) ?? "";
  const record = retrieveById(corpus, id);
  if (!record) {
    const absent: ContactResult = {
      site: id, website: null, phone: null, access: null,
      missing: ["website", "phone", "access"], note: NOT_FOUND_NOTE,
    };
    return { result: absent, cited: [] };
  }

  const primary = record.sources[0]?.u ?? "";
  const website: ContactField | null = record.website ? { value: record.website, source: record.website } : null;
  // Rule 4: the official website IS the phone's source. No website, no phone.
  const phone: ContactField | null =
    record.phone && record.website ? { value: record.phone, source: record.website } : null;
  const access: ContactField | null = record.access ? { value: record.access, source: primary } : null;

  // Field order is the order a reader expects, so the list reads the same way
  // every time. A withheld phone counts as missing: from the caller's side an
  // unpublishable number and no number at all are the same answer.
  const missing = [
    ...(website ? [] : ["website"]),
    ...(phone ? [] : ["phone"]),
    ...(access ? [] : ["access"]),
  ];

  const note = phone
    ? PHONE_NOTE
    : record.phone
      ? UNBACKED_PHONE_NOTE
      : NO_PHONE_NOTE;

  const result: ContactResult = {
    site: record.id,
    name: record.name,
    url: siteUrl(record.id),
    website,
    phone,
    access,
    missing,
    note,
    sources: record.sources,
  };
  return { result, cited: [record] };
};

const nearbySites = <T extends AtlasRecord>(corpus: readonly T[], args: Args): ToolOutcome => {
  const id = str(args.id);
  const anchor = id ? retrieveById(corpus, id) : null;
  if (id && !anchor) return { result: { found: false, id, note: NOT_FOUND_NOTE }, cited: [] };

  const lat = anchor ? anchor.lat : num(args.lat);
  const lng = anchor ? anchor.lng : num(args.lng);
  if (lat === undefined || lng === undefined) {
    return {
      result: { count: 0, records: [], note: "nearbySites needs either a site id or both lat and lng." },
      cited: [],
    };
  }

  const radiusKm = num(args.radiusKm) ?? DEFAULT_RADIUS_KM;
  const hits = nearby(corpus, { lat, lng }, { radiusKm, limit: num(args.limit), excludeId: anchor?.id });
  if (hits.length === 0) {
    return {
      result: {
        count: 0, records: [], radiusKm,
        note: `The atlas holds no other sourced site within ${radiusKm} km of that point. Say so rather than widening the search silently.`,
      },
      cited: [],
    };
  }
  return {
    result: {
      count: hits.length,
      radiusKm,
      ...(anchor ? { around: anchor.id } : { around: { lat, lng } }),
      records: hits.map((hit) => ({ ...brief(hit.record), km: hit.km })),
      note: "Distances are straight-line kilometres, not road distance.",
    },
    cited: hits.map((hit) => hit.record),
  };
};

/**
 * Circuit membership, with contested claims surfaced rather than resolved.
 *
 * `contested: true` plus the dispute's own note and citation is the whole point:
 * the atlas records that two sites claim one Jyotirlinga slot, and the assistant
 * must repeat that disagreement instead of picking a winner.
 */
const circuitMembers = <T extends AtlasRecord>(corpus: readonly T[], args: Args): ToolOutcome => {
  const circuit = str(args.circuit) ?? "";
  const memberships = circuitMembership(corpus, circuit);
  if (memberships.length === 0) {
    return { result: { circuit, count: 0, members: [], contestedCount: 0, note: NO_MATCH_NOTE }, cited: [] };
  }

  const head = memberships.slice(0, boundedLimit(num(args.limit) ?? memberships.length));
  // A contested membership must never be the entry the limit happens to cut off.
  // Truncating one away would silently restore exactly the impression this tool
  // exists to prevent — a tidy canonical list with the disagreement missing.
  // They are appended rather than promoted: reporting a dispute is not the same
  // as ranking it above the uncontested members.
  const limited = [...head, ...memberships.filter((m) => m.contested && !head.includes(m))];

  const members: CircuitMemberResult[] = limited.map(({ record, contested, dispute }) => ({
    ...brief(record),
    contested,
    ...(dispute
      ? { disputeStatus: dispute.status, disputeNote: dispute.note, ...(dispute.source ? { disputeSource: dispute.source } : {}) }
      : {}),
  }));
  const contestedCount = memberships.filter((m) => m.contested).length;

  return {
    result: {
      circuit,
      count: memberships.length,
      shown: members.length,
      contestedCount,
      members,
      ...(contestedCount > 0 ? { note: CONTESTED_NOTE } : {}),
    },
    cited: limited.map((m) => m.record),
  };
};

const EXECUTORS: Record<ToolName, <T extends AtlasRecord>(corpus: readonly T[], args: Args) => ToolOutcome> = {
  findSites, siteDetail, contactInfo, nearbySites, circuitMembers,
};

export const isToolName = (name: string): name is ToolName =>
  (TOOL_NAMES as readonly string[]).includes(name);

/**
 * Run one tool call. An unknown tool is an error returned as data, never a
 * throw: a model that hallucinates a tool name should be told so and given the
 * real list, not crash the request.
 */
export function executeTool<T extends AtlasRecord>(
  name: string,
  rawArgs: unknown,
  corpus: readonly T[],
): ToolOutcome {
  if (!isToolName(name)) {
    return {
      result: { error: `Unknown tool "${name}".`, available: [...TOOL_NAMES] },
      cited: [],
    };
  }
  return EXECUTORS[name](corpus.filter(isSourced), parseArgs(rawArgs));
}
