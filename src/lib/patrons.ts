/**
 * The patron index — who paid for these buildings.
 *
 * `patron` is a free-text field on ~100 of the corpus records. It is written the
 * way an epigraphist would write it: sometimes a bare name ("Rajaraja I"),
 * sometimes several patrons in one string ("Anawrahta & Kyanzittha"), sometimes a
 * name plus what that patron paid for ("Krishnadevaraya (59 m gopuram)"), and
 * sometimes a later benefaction appended after a semicolon ("Ahilyabai Holkar;
 * gold domes by Ranjit Singh (1835)").
 *
 * This module reads that field. It never adds to it: no patron's own dates,
 * titles, house or biography is asserted anywhere here, because the corpus holds
 * no sourced field for any of that (constitution rule 2 — no source, no field).
 * Every number a patron page shows is derived from the site records themselves.
 *
 * Like site-utils.ts, everything here is a function of its arguments only, so it
 * is testable without loading data/sites.json (which plain Node cannot import
 * without an attribute that tsc will not emit). The pages pass SITES in.
 */

import { slugify } from "./site-utils.ts";

export type PatronSource = { readonly l: string; readonly u: string };

/** Minimal shape the patron helpers need — not the full Site record. */
export type PatronSite = {
  readonly id: string;
  readonly country: string;
  readonly state?: string;
  readonly built: readonly [number, number];
  readonly patron?: string;
  readonly sources: readonly PatronSource[];
};

export type Patron<S extends PatronSite = PatronSite> = {
  /** Longest name form seen, with per-site annotations removed. Display label. */
  readonly name: string;
  readonly slug: string;
  /** Every distinct form the records actually use, verbatim. Shown to the reader. */
  readonly variants: readonly string[];
  readonly sites: readonly S[];
  readonly countries: readonly string[];
  /** Indian states (and equivalents) named by the sites; sites abroad add none. */
  readonly states: readonly string[];
  /** Earliest and latest year from the sites' own `built` ranges — nothing else. */
  readonly built: readonly [number, number];
};

/** Titles the records use inconsistently: "Ahilyabai Holkar" ≡ "Rani Ahilyabai Holkar". */
const HONORIFICS = [
  "adi", "emperor", "empress", "guru", "king", "lord", "maharaja", "maharana",
  "maharani", "prince", "princess", "queen", "raja", "rana", "rani", "sardar",
  "shri", "sri", "swami",
];

/** Reduce any run of whitespace to a single space and trim the ends. */
export const collapseSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * Split on separators that appear outside parentheses, so an annotation like
 * "(gopuram & mandapa)" is never torn in half.
 */
const splitOutsideParens = (value: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && value.startsWith(separator, i)) {
      parts.push(value.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map(collapseSpace).filter(Boolean);
};

/**
 * A fragment worth treating as a person or house: it carries a capitalised word
 * ("Kyanzittha", "Holkar") or an initialism ("BAPS", "SGPC"). A bare Roman
 * numeral is not one — "Suryavarman I & II" names one king, not two.
 */
const isNameLike = (value: string): boolean => {
  if (/[A-Z][a-z]{2,}/.test(value)) return true;
  return (value.match(/\b[A-Z]{2,}\b/g) ?? []).some((word) => !/^[IVXLCDM]+$/.test(word));
};

/**
 * Drop a lower-case lead-in that describes the benefaction rather than the
 * benefactor: "gold domes by Ranjit Singh" → "Ranjit Singh". Only clauses that
 * begin in lower case are touched, so a name never loses its first word.
 */
const stripLeadIn = (clause: string): string => {
  const stripped = clause.replace(/^[a-z][^()]*?\s(?:by|under)\s/, "");
  return stripped.length > 0 ? stripped : clause;
};

/** Remove "(…)" annotations — what this patron paid for, or an alternate name. */
const withoutAnnotations = (value: string): string =>
  collapseSpace(value.replace(/\([^)]*\)/g, " "));

/** The identity two spellings must share to be treated as one patron. */
export const patronKey = (value: string): string => {
  let key = withoutAnnotations(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const title of HONORIFICS) {
      if (key.startsWith(`${title} `) && key.length > title.length + 1) {
        key = key.slice(title.length + 1);
        changed = true;
      }
    }
  }
  return key;
};

/**
 * The benefactor named inside one clause, or "" when the clause names none.
 *
 * "gold domes by Ranjit Singh (1835)" → "Ranjit Singh"; "successors" → "".
 * The clause itself is kept verbatim as a variant, so a reader can always see
 * what the record said before this reduction.
 */
export const patronNameIn = (clause: string): string => {
  const name = withoutAnnotations(stripLeadIn(collapseSpace(clause)));
  return isNameLike(name) ? name : "";
};

/**
 * Read one `patron` field as the clauses that name a patron, verbatim.
 *
 * Semicolons always separate patrons. "&" separates them only when both sides
 * read as names, so "Bhadravarman I & successors" stays whole rather than
 * inventing a patron called "successors". Commas and slashes are never split:
 * in this corpus they are as often internal to one attribution
 * ("Dharna Shah, under Rana Kumbha") as between two.
 */
export const patronMentions = (patron: string | undefined): readonly string[] => {
  if (!patron) return [];
  const mentions: string[] = [];
  for (const clause of splitOutsideParens(collapseSpace(patron), ";")) {
    const parts = splitOutsideParens(clause, " & ");
    const usable = parts.length > 1 && parts.every(isNameLike) ? parts : [clause];
    for (const part of usable) {
      if (patronNameIn(part)) mentions.push(part);
    }
  }
  return mentions;
};

/** URL slug for a patron, reusing the corpus-wide slug rule. */
export const patronSlug = (name: string): string => slugify(name);

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

/** Longest name form wins; ties break alphabetically so the label is stable. */
const pickLabel = (forms: readonly string[]): string =>
  [...forms].sort((a, b) => b.length - a.length || a.localeCompare(b))[0];

type Draft<S extends PatronSite> = {
  forms: string[];
  variants: string[];
  sites: S[];
  seen: Set<string>;
};

/**
 * Every patron named anywhere in `sites`, most-funded first.
 *
 * A site with a compound `patron` field belongs to each patron it names, so the
 * site counts sum to more than the number of records carrying the field — but
 * no site is ever counted twice under one patron.
 */
export const allPatrons = <S extends PatronSite>(sites: readonly S[]): readonly Patron<S>[] => {
  const drafts = new Map<string, Draft<S>>();

  for (const site of sites) {
    for (const mention of patronMentions(site.patron)) {
      const form = patronNameIn(mention);
      const key = patronKey(form);
      if (!key) continue;
      const draft = drafts.get(key) ?? { forms: [], variants: [], sites: [], seen: new Set<string>() };
      if (!drafts.has(key)) drafts.set(key, draft);
      draft.forms.push(form);
      draft.variants.push(mention);
      if (!draft.seen.has(site.id)) {
        draft.seen.add(site.id);
        draft.sites.push(site);
      }
    }
  }

  const patrons = [...drafts.values()].map((draft) => {
    const name = pickLabel(draft.forms);
    return {
      name,
      slug: patronSlug(name),
      variants: uniqueSorted(draft.variants),
      sites: [...draft.sites].sort((a, b) => a.built[0] - b.built[0]),
      countries: uniqueSorted(draft.sites.map((s) => s.country)),
      states: uniqueSorted(draft.sites.flatMap((s) => (s.state ? [s.state] : []))),
      built: [
        Math.min(...draft.sites.map((s) => s.built[0])),
        Math.max(...draft.sites.map((s) => s.built[1])),
      ] as readonly [number, number],
    };
  });

  return patrons.sort((a, b) => b.sites.length - a.sites.length || a.name.localeCompare(b.name));
};

export const findPatron = <S extends PatronSite>(
  patrons: readonly Patron<S>[],
  slug: string,
): Patron<S> | undefined => patrons.find((p) => p.slug === slug);

/** How many records carry a patron this index could read — the honest denominator. */
export const patronedSiteCount = (sites: readonly PatronSite[]): number =>
  sites.filter((s) => patronMentions(s.patron).length > 0).length;

/** Distinct citations behind a patron's sites, in the order the records give them. */
export const patronSources = (patron: Patron): readonly PatronSource[] => {
  const seen = new Set<string>();
  const out: PatronSource[] = [];
  for (const site of patron.sites) {
    for (const source of site.sources) {
      if (seen.has(source.u)) continue;
      seen.add(source.u);
      out.push(source);
    }
  }
  return out;
};

const ORDINALS = ["th", "st", "nd", "rd"] as const;

/** "12th", "21st", "3rd" — English ordinal for a century number. */
const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (ORDINALS[n % 10] ?? "th");
  return `${n}${suffix}`;
};

/** The century a year falls in: 1780 → 18 CE, -650 → 7 BCE. */
export const centuryOf = (year: number): { readonly n: number; readonly bce: boolean } =>
  year < 0
    ? { n: Math.floor((-year - 1) / 100) + 1, bce: true }
    : { n: Math.floor(Math.max(0, year - 1) / 100) + 1, bce: false };

/** "18th c.", "12th–16th c.", "7th c. BCE – 2nd c. CE" — derived from `built` only. */
export const centurySpan = (built: readonly [number, number]): string => {
  const from = centuryOf(built[0]);
  const to = centuryOf(built[1]);
  if (from.bce === to.bce && from.n === to.n) return `${ordinal(from.n)} c.${from.bce ? " BCE" : ""}`;
  if (from.bce === to.bce) return `${ordinal(from.n)}–${ordinal(to.n)} c.${from.bce ? " BCE" : ""}`;
  return `${ordinal(from.n)} c. BCE – ${ordinal(to.n)} c. CE`;
};

/** "Tamil Nadu · Bihar · Uttar Pradesh" or, for a patron abroad, the countries. */
export const regionSpan = (patron: Patron): string => {
  const regions = patron.states.length > 0 ? patron.states : patron.countries;
  const extra = patron.states.length > 0 && patron.countries.length > 1 ? patron.countries : [];
  const head = regions.length > 3 ? `${regions.slice(0, 3).join(" · ")} +${regions.length - 3}` : regions.join(" · ");
  return extra.length > 0 ? `${head} (${extra.join(", ")})` : head;
};
