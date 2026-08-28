/**
 * What a record's tier promises, and what it has actually sourced.
 *
 * The vocabulary here mirrors `data/vocab/tiers.json` (see docs/TIERS.md) but
 * deliberately does NOT import it: `sites.ts` already shows what happens when a
 * module loads JSON at import time — it becomes untestable under plain Node,
 * which needs an import attribute that tsc does not emit. Everything below is a
 * function of its arguments only, so completeness.test.ts can exercise it
 * directly. If tiers.json changes, this file changes with it.
 *
 * The one posture that matters: an absent field means WE HAVE NOT SOURCED IT.
 * It never means the fact is unknown, unavailable, or that the site lacks the
 * thing. This project omits rather than guesses (CLAUDE.md rule 2), so every
 * label and count here is phrased as a statement about our citations.
 */

export type TierKey = "stub" | "compact" | "flagship";

/**
 * The nine reader-facing fields a record can carry, on top of the stub floor.
 *
 * The stub fields (id, name, country, place, lat, lng, tradition, sources) are
 * excluded on purpose: `scripts/validate-data.mjs` refuses to publish a record
 * without them, so counting them would pad every badge with eight fields that
 * are present by construction and say nothing.
 *
 * `dating` covers `built` + `builtDisplay`, which are one fact in two shapes.
 */
export type FieldKey =
  | "significance" | "deity" | "dating" | "dynasty" | "style"
  | "access" | "story" | "patron" | "independentSource";

export type ScaleField = {
  readonly key: FieldKey;
  /** Reader-facing name, phrased to complete "not yet sourced: …". */
  readonly label: string;
  /** The tier at which this field is expected. */
  readonly tier: TierKey;
  /**
   * False for a field a tier "also expects" rather than `requires`
   * (tiers.json → flagship.also_expects.non_wikipedia_source).
   */
  readonly required: boolean;
};

/**
 * The scale, ordered by how much the field adds FOR A READER OF THE PAGE — this
 * order alone decides the "most useful next" prompt, so it is a constant rather
 * than a heuristic, and identical inputs always produce an identical answer.
 *
 * The compact essentials come first: a record missing them cannot be read at
 * all. Among the deeper fields, `access` leads because it is the one fact a
 * pilgrim cannot get from the page's prose and the rarest in the corpus
 * (100 of 1126); the katha is next; `patron` and a second source deepen a
 * record that already reads, so they come last.
 */
export const FIELD_SCALE: readonly ScaleField[] = [
  { key: "significance",      label: "its documented history",     tier: "compact",  required: true },
  { key: "deity",             label: "the presiding deity",        tier: "compact",  required: true },
  { key: "dating",            label: "when it was built",          tier: "compact",  required: true },
  { key: "dynasty",           label: "the dynasty that built it",  tier: "compact",  required: true },
  { key: "style",             label: "its architectural style",    tier: "compact",  required: true },
  { key: "access",            label: "how to reach it",            tier: "flagship", required: true },
  { key: "story",             label: "its sthala katha",           tier: "flagship", required: true },
  { key: "patron",            label: "who paid for it",            tier: "flagship", required: true },
  { key: "independentSource", label: "a source beyond Wikipedia",  tier: "flagship", required: false },
] as const;

/** Tier rank, matching tiers.json. A field belongs to a tier once its rank is reached. */
const TIER_RANK: Readonly<Record<TierKey, number>> = { stub: 1, compact: 2, flagship: 3 };

const TIER_LABEL: Readonly<Record<TierKey, string>> = {
  stub: "Gazetteer stub",
  compact: "Compact record",
  flagship: "Flagship record",
};

/** The minimum a record must carry for this module to say anything about it. */
export type Recorded = {
  readonly tier?: string;
  readonly deity?: string;
  readonly builtDisplay?: string;
  readonly dynasty?: string;
  readonly style?: string;
  readonly significance?: string;
  readonly story?: string;
  readonly access?: string;
  readonly patron?: string;
  readonly sources?: readonly { readonly u?: string }[];
};

export type FieldState = ScaleField & { readonly present: boolean };

export type Completeness = {
  /** The tier whose promise this record is measured against. */
  readonly tier: TierKey;
  /** "Compact record" — or a plain "Record" when the label was not recognised. */
  readonly tierLabel: string;
  /** False when `tier` was a string tiers.json does not define. */
  readonly recognisedTier: boolean;
  /** Every field on the scale, in value order, with its sourced state. */
  readonly fields: readonly FieldState[];
  readonly present: readonly FieldState[];
  /** Fields we have not sourced yet, in value order. Never "unknown" fields. */
  readonly absent: readonly FieldState[];
  readonly sourcedCount: number;
  readonly total: number;
  /** Share of the nine-field scale that is sourced, rounded. */
  readonly pct: number;
  /** The fields this record's own tier promises. */
  readonly promised: readonly FieldState[];
  /** Its tier's promised fields that are not yet sourced. */
  readonly promisedAbsent: readonly FieldState[];
  /** True when the record keeps every promise its tier makes. */
  readonly meetsTier: boolean;
  /** The most valuable field not yet sourced, or null when the scale is full. */
  readonly next: FieldState | null;
};

/**
 * Wikimedia hosts. tiers.json asks a flagship record for "at least one source
 * that is not Wikipedia"; the sister projects are the same corpus under other
 * names, so they do not count as independent either.
 */
const WIKIMEDIA = /\bwiki(pedia|data|media|source|voyage|books|quote)\.org\b/i;

const filled = (value?: string): boolean => typeof value === "string" && value.trim() !== "";

/** True when at least one citation is not a Wikimedia property. */
export const hasIndependentSource = (record: Recorded): boolean =>
  (record.sources ?? []).some((s) => filled(s?.u) && !WIKIMEDIA.test(s!.u!));

const isSourced = (record: Recorded, key: FieldKey): boolean => {
  switch (key) {
    case "significance": return filled(record.significance);
    case "deity": return filled(record.deity);
    case "dating": return filled(record.builtDisplay);
    case "dynasty": return filled(record.dynasty);
    case "style": return filled(record.style);
    case "access": return filled(record.access);
    case "story": return filled(record.story);
    case "patron": return filled(record.patron);
    case "independentSource": return hasIndependentSource(record);
  }
};

const isTierKey = (value: string): value is TierKey =>
  value === "stub" || value === "compact" || value === "flagship";

/**
 * The tier a record is measured against.
 *
 * An absent OR unrecognised `tier` reads as `stub`, for one reason: a tier is a
 * PROMISE, and neither case is a promise this project actually made. The badge
 * then under-claims rather than announcing a contract the record never entered.
 *
 * This returned `flagship` for an absent tier until 2026-08-28 — the old corpus
 * convention, where 68 records carried no tier and were read as the highest one.
 * That made ABSENCE encode the STRONGEST claim, so any record added without the
 * field silently promised `story` + `access` + `patron` and then failed its own
 * promise. Records arrive in automated batches, so that was a question of when.
 *
 * Closed on three sides together: those 68 records now carry `tier: "flagship"`
 * explicitly (all 68 genuinely met it, verified before the backfill),
 * `validate-data.mjs` refuses to publish a record without the field, and the
 * default here is the weakest tier. See CONTENT-CONTRACT.md section 2.1.
 */
export const resolveTier = (raw?: string | null): TierKey => {
  if (!filled(raw ?? undefined)) return "stub";
  const key = raw!.trim().toLowerCase();
  return isTierKey(key) ? key : "stub";
};

/** Whether a tier's promise reaches a given field. */
const promises = (tier: TierKey, field: ScaleField): boolean =>
  field.required && TIER_RANK[tier] >= TIER_RANK[field.tier];

/**
 * Measure one record against the scale.
 *
 * Total is always the full nine, on every tier, so "6 of 9" means the same
 * thing on every page in the atlas. What the tier changes is which of those
 * nine it actually promised — `meetsTier` and `promisedAbsent` carry that.
 */
export const completenessOf = (record: Recorded): Completeness => {
  const tier = resolveTier(record.tier);
  // An absent tier is no longer a recognised convention, it is a missing field.
  // validate-data.mjs refuses to publish one, so reaching here means a fixture
  // or a caller outside the corpus; "Record" is the honest label for that.
  const recognisedTier = filled(record.tier) && isTierKey(record.tier!.trim().toLowerCase());

  const fields: readonly FieldState[] = FIELD_SCALE.map((field) => ({
    ...field,
    present: isSourced(record, field.key),
  }));

  const present = fields.filter((f) => f.present);
  const absent = fields.filter((f) => !f.present);
  const promised = fields.filter((f) => promises(tier, f));
  const promisedAbsent = promised.filter((f) => !f.present);

  return {
    tier,
    tierLabel: recognisedTier ? TIER_LABEL[tier] : "Record",
    recognisedTier,
    fields,
    present,
    absent,
    sourcedCount: present.length,
    total: fields.length,
    pct: Math.round((100 * present.length) / fields.length),
    promised,
    promisedAbsent,
    meetsTier: promisedAbsent.length === 0,
    next: absent[0] ?? null,
  };
};

/**
 * Words that state absence as a fact about the world instead of a fact about
 * our sourcing. None of them may appear in a field label or in the badge's copy
 * (src/app/Completeness.tsx) — completeness.test.ts fails on either.
 *
 * This is the whole posture of the project in one list: we do not know that the
 * patron is unrecorded, only that we have not sourced one. Saying otherwise on
 * 1,058 compact pages would publish a claim we cannot support, which is the one
 * thing CLAUDE.md rule 2 exists to prevent.
 */
export const ABSENCE_CLAIM_WORDS: readonly string[] = [
  "unknown", "unavailable", "not available", "no data", "n/a", "none", "missing", "lost to history",
] as const;

/** "how to reach it and who paid for it" — for the badge's absent-field line. */
export const listLabels = (fields: readonly FieldState[]): string => {
  const labels = fields.map((f) => f.label);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};
