/**
 * What a record's `verified` stamp actually means, said honestly.
 *
 * The field looks like a date and is named like a human act, and it is neither.
 * Its real values, across 3,031 records:
 *
 *   wikipedia-2026-08-27          2,102      wikidata-2026-08-27       24
 *   wikipedia-2026-08-28            760      wikipedia-corrected-...    2
 *   wikipedia-2026-08-26            141      curated-unverified         2
 *
 * Two thousand one hundred and two records share one timestamp. That is not
 * 2,102 verifications; it is ONE automated pass that checked 2,102 records
 * against Wikipedia in an afternoon. Rendering it as "verified 2026-08-27"
 * claims a human read each record and confirmed it, which is false, and it is
 * the kind of false claim that costs a reference work its credibility precisely
 * when someone checks.
 *
 * So this module separates the two things the stamp actually encodes — a METHOD
 * and a DATE — and never lets the word "verified" stand alone in front of an
 * automated check. `curated-unverified` is given its own explicit treatment
 * rather than being allowed to render as a verification of any kind.
 *
 * Pure and corpus-free, so it is testable without loading data/sites.json.
 */

export type VerificationKind = "automated" | "corrected" | "unverified" | "unknown";

export type Verification = {
  readonly kind: VerificationKind;
  /** Reader-facing sentence. Never contains the bare word "verified" for an automated check. */
  readonly label: string;
  /** The source checked against, when the stamp names one. */
  readonly source: string | null;
  /** ISO date the check ran, when the stamp carries one. */
  readonly date: string | null;
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  wikipedia: "Wikipedia",
  wikidata: "Wikidata",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-27" -> "27 Aug 2026". Returns null for anything that is not a plain ISO date. */
export const formatStampDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return null;
  return `${Number(day)} ${name} ${year}`;
};

/**
 * Read a `verified` stamp.
 *
 * Recognised shapes: `<source>-<iso-date>`, `<source>-corrected-<iso-date>`,
 * and the literal `curated-unverified`. Anything unrecognised is reported as
 * `unknown` and described as an unrecorded provenance — never upgraded to a
 * verification on the strength of the field merely being present.
 */
export function readVerification(raw?: string | null): Verification {
  const value = (raw ?? "").trim().toLowerCase();

  if (!value) {
    return { kind: "unknown", label: "How these coordinates were checked is not recorded.", source: null, date: null };
  }

  if (value === "curated-unverified") {
    return {
      kind: "unverified",
      // Says what IS true — a person entered it — and what is NOT — that anything
      // checked it. Never the word "verified", in any form, for this value.
      label: "Entered by hand and not yet checked against a source.",
      source: null,
      date: null,
    };
  }

  const corrected = /^([a-z]+)-corrected-(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (corrected) {
    const [, source, date] = corrected;
    const name = SOURCE_LABELS[source] ?? source;
    return {
      kind: "corrected",
      label: `Corrected against ${name} on ${formatStampDate(date)}.`,
      source: name,
      date,
    };
  }

  const automated = /^([a-z]+)-(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (automated) {
    const [, source, date] = automated;
    const name = SOURCE_LABELS[source] ?? source;
    return {
      kind: "automated",
      // "Checked automatically", not "verified". The distinction is the whole
      // point of this module: a script compared two values, nobody read it.
      label: `Checked automatically against ${name} on ${formatStampDate(date)}.`,
      source: name,
      date,
    };
  }

  return { kind: "unknown", label: "How these coordinates were checked is not recorded.", source: null, date: null };
}

/**
 * Words this module must never emit for an automated check.
 *
 * Asserted by verification.test.ts against every real corpus value. "verified"
 * is banned outright: there is no automated result it can honestly describe,
 * and it is the exact overclaim this module exists to prevent.
 */
export const OVERCLAIM_WORDS: readonly string[] = ["verified", "confirmed", "authenticated", "validated"];
