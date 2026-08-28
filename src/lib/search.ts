/**
 * Search, synonym expansion and faceting over the corpus.
 *
 * Pure functions only — no React, no data import. Like `site-utils.ts`, this
 * file is a function of its arguments so it can be tested by `node --test`
 * without pulling data/sites.json into the runner. `sites.ts` loads the corpus
 * at module scope, so importing it here would make the whole module untestable.
 *
 * SCOPE (constitution rule 2): this searches fields that already exist on a
 * record. It never adds, infers, or writes data. The synonym and deity-alias
 * tables below are query-side spelling knowledge — they widen what a user can
 * type to reach a record, and never change what the record says.
 */

import { ERAS, eraIndex } from "./site-utils.ts";
import {
  bucketByLength, foldPhrase, queryKey, withinEditBudget, MIN_EDIT_LENGTH, type KeyBuckets,
} from "./fuzzy.ts";

/**
 * The minimal shape search needs. `Site` from sites.ts is structurally
 * assignable to it; declaring it here keeps the corpus out of the test runner.
 */
export type Searchable = {
  readonly name: string;
  readonly alt?: string;
  readonly native?: string;
  readonly country: string;
  readonly state?: string;
  readonly place: string;
  readonly tradition: string;
  /**
   * Free text, exactly as sourced: "Meenakshi (Parvati) & Sundareswarar
   * (Shiva)". It carries the epithet and the consort, which is the interesting
   * part, and it is what a record page SHOWS. It is a hopeless thing to filter
   * on — see `deities` below, which is the index beside it, never a replacement.
   */
  readonly deity: string;
  /**
   * Canonical deity tags, generated onto the corpus by
   * scripts/build-deity-tags.mjs from data/vocab/deity.json. Multi-valued: a
   * record dedicated to a divine couple carries both.
   *
   * OPTIONAL, and legitimately absent: a dedication that names no figure — a
   * relic stupa, a monastic university, "Parabrahma, worshipped without image" —
   * gets no tag rather than a guessed one (constitution rule 2). Such a record
   * must contribute to no deity facet and render no deity chip. Do not
   * substitute a placeholder value for the absence.
   */
  readonly deities?: readonly string[];
  /** The tradition stream the tags roll up to: Shaiva, Vaishnava, Shakta, … */
  readonly deityGroup?: string;
  readonly dynasty: string;
  readonly style: string;
  readonly circuits?: readonly string[];
  readonly tier?: string;
  /**
   * Optional: the client index defers this column off the critical path, so a
   * record legitimately has no significance until `loadSignificance()` resolves.
   * `haystackOf` treats a missing value as an empty contribution, which means an
   * early search matches on name/place/deity and silently gains full-text depth
   * once the chunk lands.
   */
  readonly significance?: string;
  readonly built: readonly [number, number];
};

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------

/** Combining marks left behind by NFD decomposition (Ś -> S + U+0301). */
const COMBINING_MARKS = /[\u0300-\u036f]/g;
/**
 * Anything that is not a letter, number or combining mark, in any script.
 * Marks are kept: Latin diacritics are already gone by this point, while Indic
 * vowel signs and viramas are load-bearing letters of the `native` field.
 */
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;

/**
 * Fold a string to its comparable form: diacritics removed, lowercased, and
 * punctuation collapsed to single spaces.
 *
 * Letters outside Latin are kept, not stripped, so a Devanagari or Tamil query
 * still reaches the `native` field. `slugify` in site-utils.ts deliberately does
 * the opposite (it must emit URL-safe ASCII) — the two are not interchangeable.
 */
export const normalise = (value: string): string =>
  value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();

/** Normalised, whitespace-separated words. */
export const tokenise = (value: string): string[] =>
  normalise(value).split(" ").filter(Boolean);

// ---------------------------------------------------------------------------
// synonyms — transliteration variants, expanded on the QUERY side
// ---------------------------------------------------------------------------

/**
 * Groups of spellings that mean the same thing in this corpus.
 *
 * Every member of a group expands to every other member. Groups that share a
 * member are merged (temple/kovil and koil/kovil/koyil become one set), so
 * "temple" reaches a record spelled "Koyil".
 *
 * Expansion happens on the query, never on the corpus: the stored text is
 * exactly what its source says.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["sri", "shri", "shree", "sree"],
  ["ishwar", "iswar", "eshwar", "eeswarar", "isvara", "ishvara", "eswarar", "eeswaran", "eswaran", "easwaran"],
  ["swamy", "swami", "svami", "svamy"],
  ["koil", "kovil", "koyil"],
  ["temple", "mandir", "mandira", "kovil", "devalaya", "gudi"],
  ["perumal", "vishnu", "visnu", "narayana", "narayan"],
  ["amman", "ammal", "devi", "mata", "mataji"],
  ["natha", "nath"],
  ["linga", "lingam"],
] as const;

const buildSynonyms = (groups: readonly (readonly string[])[]): Record<string, readonly string[]> => {
  const sets = new Map<string, Set<string>>();
  for (const group of groups) {
    const merged = new Set(group.map(normalise));
    // Fold in every set a member already belongs to, so overlapping groups join.
    for (const term of [...merged]) for (const existing of sets.get(term) ?? []) merged.add(existing);
    for (const term of merged) sets.set(term, merged);
  }
  const out: Record<string, readonly string[]> = {};
  for (const [term, set] of sets) out[term] = [...set].sort();
  return out;
};

/** term -> every spelling it may be written as (including itself). */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = buildSynonyms(SYNONYM_GROUPS);

/** The spellings a single query word should be tried as. */
export const expandToken = (token: string): readonly string[] => SYNONYMS[token] ?? [token];

// ---------------------------------------------------------------------------
// deity aliases
// ---------------------------------------------------------------------------
//
// There was, until now, a `principalDeities` heuristic here: ~90 marker patterns
// that classified the free-text `deity` into ten coarse labels, and it backed the
// "deity" facet. It is deleted, not kept as a fallback for the untagged records.
//
// The corpus now carries real tags — `deities` / `deityGroup`, generated from
// data/vocab/deity.json — and two classifiers that can disagree are worse than
// one with holes. A fallback would mean a record's own page reading the
// heuristic while the facet read the tags, so a site could show a "Shiva" chip
// and still be missing from the Shiva facet: invisible in code review, obvious
// to a reader. Where heuristic and vocabulary disagree, the vocabulary is what
// gets fixed.
//
// The heuristic's own failure mode is why it cannot be the safety net: it fired
// on the TRADITION word, so "Buddhist monastic complex" and "Theravada Buddhist
// temple" came back as Buddha. Those dedications name no figure, and inventing
// one for them is what constitution rule 2 forbids.

const PARENTHETICAL = /\(([^)]+)\)/g;

/**
 * Extra terms a record's deity should also be findable by: whatever is in
 * parentheses ("Azhagiya Manavalan (Vishnu)" -> "Vishnu") and the head before
 * them ("Azhagiya Manavalan").
 *
 * Pure text extraction — it splits the string it is given and adds nothing to
 * it. What the deity *is* now comes from `deities`, which `haystackOf` reads
 * directly.
 */
export const deityAliases = (deity: string): string[] => {
  const out = new Set<string>();
  for (const hit of deity.matchAll(PARENTHETICAL)) {
    const inner = hit[1].trim();
    if (inner) out.add(inner);
  }
  const head = deity.split("(")[0].trim();
  if (head) out.add(head);
  return [...out];
};

// ---------------------------------------------------------------------------
// matching — the precedence ladder
// ---------------------------------------------------------------------------
//
// WHOLE TOKEN vs FRAGMENT is the discriminator, not field vs field.
//
// The bug this ladder exists for: "thirupathi" ranked Pataleeswarar Temple at
// *Thirupathi*puliyur above Sri Venkateswara Temple, Tirumala. Both are real
// hits. One is the temple the asker meant. The reason the wrong one won was that
// "thirupathi" is an exact SUBSTRING of "thirupathiripuliyur", while Tirumala's
// "Tirupati" is only reachable by folding the transliteration — and the ranking
// put every exact match above every folded one.
//
// The fix is NOT to make a name match outrank a place match. That is
// special-casing: it would answer this query and break "temples in Madurai",
// where the place IS the question. The real signal is that
//
//   "thirupathi" folds to the SAME WHOLE WORD as "tirupati"        <- a word
//   "thirupathi" sits inside the longer word "thirupathiripuliyur" <- a fragment
//
// and a whole word, even a folded one, is a stronger claim to be what someone
// meant than a fragment of a longer word. Someone typing "thirupathi" is
// naming a place; nobody types it meaning the first ten letters of somewhere
// else. That principle decides this query and generalises to every other.
//
// So each query word scores against each record on two axes, in this order:
//
//   1. TIER — how the word is present:
//        token     the whole word, spelled as the reader typed it
//        synonym   the whole word, in another spelling this corpus knows
//                  ("perumal" for "vishnu"). Below `token` because a reader
//                  who types "vishnu" means vishnu: without this rung, the
//                  dozens of Perumal shrines that carry the synonym in their
//                  NAME outrank Sri Venkateswara at Tirumala, which carries
//                  the typed word in its deity — expansion beating intent.
//        stem      the FOLD of the typed word is a whole word the record
//                  actually stores. One side was normalised, not two.
//        fold      the typed word and a stored word fold to the same key,
//                  which is a key NEITHER of them is spelled as. Two sides
//                  normalised, so a rung weaker than `stem`.
//        near      a whole word within the edit budget of a fold
//        near      a whole word within the edit budget of a fold
//        prefix    the opening of a longer word ("meena" in "meenakshi")
//        substring buried inside a longer word ("pathi" in "thirupathi...")
//   2. FIELD — where it is present: name > place/deity > dynasty/style >
//      significance. This only ever breaks a tie WITHIN a tier, which is what
//      keeps it from becoming the special case above.
//
// `stem` is the rung that finishes the reported bug, and it is worth stating
// plainly because it is not obvious. Once the fragment was demoted, "thirupathi"
// was left with two whole-word FOLD hits: Irattai *Thiruppathy*, which has it in
// its NAME, and Tirumala, which has "Tirupati" in its PLACE. On tier and field
// alone the name wins, and that is the wrong answer — so the field weight would
// have had to be bent, which is the special case this whole design refuses.
//
// What actually separates them is how far each is from what was typed:
//
//   "thirupathi" folds to "tirupati", and Tirumala STORES "Tirupati"
//   "thirupathi" folds to "tirupati", and so does the stored "Thiruppathy",
//                but the record is spelled neither way
//
// One normalisation versus two. That is the same confidence gradient fuzzy.ts
// already uses to put `phonetic` above `edit`, applied one level up, and it
// needs no knowledge of which field or which record is involved.
//
// Both are folded into one integer so a record's score is one comparison. The
// score of a MULTI-word query is the weakest of its words: every word must be
// present (AND semantics are unchanged), and a query is only as well answered
// as its worst-answered word.

/** How a word is present in a field, strongest first. Ordering is the contract. */
export type TierName =
  "none" | "substring" | "prefix" | "near" | "fold" | "stem" | "synonym" | "token";

export const TIER: Readonly<Record<TierName, number>> = Object.freeze({
  none: -1,
  substring: 0,
  prefix: 1,
  near: 2,
  fold: 3,
  stem: 4,
  synonym: 5,
  token: 6,
});

/**
 * The field groups, HEAVIEST FIRST — the order is load-bearing twice over: it is
 * the field weight (`GROUP_COUNT - index`), and it lets the ladder stop at the
 * first whole-word hit, since no lighter group can beat one.
 *
 * The four cover exactly the fields the old flat haystack covered, and nothing
 * more: splitting them changes what a match is WORTH, never what matches.
 */
const GROUP_COUNT = 4;
const NAMES = 0;
const IDENTITY = 1;
const ATTRIBUTION = 2;
const PROSE = 3;

/**
 * Tier and field packed into one integer: `tier * FIELD_SPAN + weight`.
 *
 * `FIELD_SPAN` is above the largest weight, so comparing packed scores is
 * exactly comparing (tier, weight) lexicographically — which is the ladder.
 */
const FIELD_SPAN = 8;
const packed = (tier: number, group: number): number => tier * FIELD_SPAN + (GROUP_COUNT - group);

/** No match at all. Distinct from 0, which is a real (substring, prose) hit. */
export const NO_MATCH = -1;

/** The tier a packed score was won at. */
export const tierOf = (score: number): number =>
  score < 0 ? TIER.none : Math.floor(score / FIELD_SPAN);

/**
 * True for the three rungs that only got there by folding the spelling.
 * `token` and `synonym` above them, and `prefix`/`substring` below, all matched
 * the letters the reader actually typed.
 */
const isFolded = (tier: number): boolean => tier >= TIER.near && tier <= TIER.stem;

// ---------------------------------------------------------------------------
// the per-record index
// ---------------------------------------------------------------------------

/**
 * A record's searchable text, by field group.
 *
 * Every string is SPACE-PADDED — " meenakshi amman temple " — which is the whole
 * trick that makes the ladder cheap: with the pad in place, `includes(" x ")`
 * is a whole-word test, `includes(" x")` a word-prefix test and `includes("x")`
 * a substring test, on the same string, with no tokenising and no allocation.
 *
 * `folded` and `buckets` are built lazily and only when the ladder actually
 * needs them — see `foldedOf` and `bucketsOf`.
 */
type RecordKeys = {
  readonly plain: readonly string[];
  folded: readonly string[] | null;
  buckets: readonly KeyBuckets[] | null;
};

/** Records are immutable, so their folded text can be cached by identity. */
const indexes = new WeakMap<object, RecordKeys>();

/** Normalise a group's fields into one padded phrase; "" when it has no text. */
const padGroup = (parts: readonly string[]): string => {
  const text = normalise(parts.join(" "));
  return text ? ` ${text} ` : "";
};

const keysOf = (site: Searchable): RecordKeys => {
  const cached = indexes.get(site);
  if (cached !== undefined) return cached;
  const built: RecordKeys = {
    plain: [
      padGroup([site.name, site.alt ?? "", site.native ?? ""]),
      padGroup([
        site.deity,
        deityAliases(site.deity).join(" "),
        // The canonical tags and their stream, so "Murugan" reaches a record whose
        // deity string only says "Swaminathaswamy", and "Shakta" reaches every
        // goddess temple. Absent on a record whose dedication names no figure —
        // which contributes nothing here rather than a placeholder.
        (site.deities ?? []).join(" "),
        site.deityGroup ?? "",
        site.place,
        site.state ?? "",
        site.country,
      ]),
      padGroup([site.dynasty, site.style, (site.circuits ?? []).join(" ")]),
      padGroup([site.significance ?? ""]),
    ],
    folded: null,
    buckets: null,
  };
  indexes.set(site, built);
  return built;
};

/**
 * The transliteration folds of the same text, one padded phrase per group.
 *
 * LAZY: a query whose every word lands as a whole word never folds anything, so
 * the common case pays nothing for the fallback. `foldPhrase` de-duplicates, so
 * the folded prose is materially shorter than the prose.
 */
const foldedOf = (keys: RecordKeys): readonly string[] => {
  if (keys.folded !== null) return keys.folded;
  const built = keys.plain.map((text) => (text ? ` ${foldPhrase(text).join(" ")} ` : ""));
  keys.folded = built;
  return built;
};

/**
 * The same folds bucketed by length, for the edit tier only.
 *
 * Lazier still: the edit tier is the last resort, needs a folded key of at least
 * `MIN_EDIT_LENGTH` characters, and most searches never reach it at all.
 */
const bucketsOf = (keys: RecordKeys): readonly KeyBuckets[] => {
  if (keys.buckets !== null) return keys.buckets;
  const built = foldedOf(keys).map((text) => bucketByLength(text));
  keys.buckets = built;
  return built;
};

// ---------------------------------------------------------------------------
// the compiled query
// ---------------------------------------------------------------------------

/**
 * One query word, in every form the ladder tests a record against.
 *
 * Built ONCE per search rather than once per record: the padded variants and the
 * phonetic folds are identical for all 2,796 records, and deriving them inside
 * the record loop was pure waste.
 */
type Term = {
  /** The word as typed, then `" word "` and `" word` — its three probes. */
  readonly typed: string;
  readonly typedWhole: string;
  readonly typedHead: string;
  /** The OTHER spellings this corpus knows for it. Usually empty. */
  readonly plain: readonly string[];
  /** `" spelling "` — the whole-word probe. */
  readonly whole: readonly string[];
  /** `" spelling"` — the word-prefix probe. */
  readonly head: readonly string[];
  /**
   * `" fold "` — the whole-folded-word probe, for the `stem` rung, which reads
   * the LITERAL text. A fold identical to a probe the literal pass already ran
   * is dropped: re-scanning the same string for the same needle is pure cost.
   */
  readonly stems: readonly string[];
  /** `" fold "` — the whole-folded-word probe. Empty when the word is too short to fold. */
  readonly folds: readonly string[];
  /** Folds long enough for an edit to be forgiven. Usually empty. */
  readonly edits: readonly string[];
};

/** A query string reduced to the terms every record is tested against. */
export type CompiledQuery = { readonly terms: readonly Term[] };

/** Nothing was typed: every record matches, and no record outranks another. */
export const EMPTY_COMPILED: CompiledQuery = Object.freeze({ terms: [] });

const compileTerm = (token: string): Term => {
  const expanded = expandToken(token);
  const plain = expanded.filter((variant) => variant !== token);
  const folds: string[] = [];
  const edits: string[] = [];
  for (const key of new Set(expanded.map(queryKey))) {
    if (!key) continue;
    folds.push(` ${key} `);
    if (key.length >= MIN_EDIT_LENGTH) edits.push(key);
  }
  const whole = plain.map((variant) => ` ${variant} `);
  const literal = new Set([` ${token} `, ...whole]);
  return {
    typed: token,
    typedWhole: ` ${token} `,
    typedHead: ` ${token}`,
    plain,
    whole,
    head: plain.map((variant) => ` ${variant}`),
    stems: folds.filter((fold) => !literal.has(fold)),
    folds,
    edits,
  };
};

export const compileQuery = (query: string): CompiledQuery => {
  const tokens = tokenise(query);
  return tokens.length === 0 ? EMPTY_COMPILED : { terms: tokens.map(compileTerm) };
};

// ---------------------------------------------------------------------------
// the ladder itself
// ---------------------------------------------------------------------------

/**
 * The strongest LITERAL tier of one term in one padded group.
 *
 * The word as typed is tried first and on its own, because only it can reach
 * `TIER.token`; a synonym spelling tops out at `TIER.synonym`. A partial hit
 * (prefix or fragment) is worth the same either way — the distinction that
 * matters is whole word vs fragment, and splitting the fragment tiers by
 * spelling would be precision nobody can perceive.
 */
const literalTier = (hay: string, term: Term): number => {
  let best = TIER.none;
  // The cheap reject: if the word is nowhere in this group, neither is any
  // stronger form of it. One scan settles the common case.
  if (hay.includes(term.typed)) {
    if (hay.includes(term.typedWhole)) return TIER.token;
    best = hay.includes(term.typedHead) ? TIER.prefix : TIER.substring;
  }
  for (let v = 0; v < term.plain.length; v += 1) {
    if (!hay.includes(term.plain[v])) continue;
    const tier = hay.includes(term.whole[v]) ? TIER.synonym
      : hay.includes(term.head[v]) ? TIER.prefix
      : TIER.substring;
    if (tier > best) best = tier;
    if (best === TIER.synonym) break;
  }
  return best;
};

/**
 * The packed score of one query word against one record, or `NO_MATCH`.
 *
 * Three passes, each a whole rung of the ladder, each skipped once a stronger
 * rung has answered:
 *
 *   1. literal — and a whole-word hit RETURNS immediately. It is the top tier,
 *      the groups are heaviest-first, so nothing later can beat it.
 *   2. fold — reached only when no group held the word whole. Any folded whole
 *      word outranks any prefix or fragment (that is the ladder), so the first
 *      hit, in the heaviest group, is the answer.
 *   3. edit — the last resort, and normally not even attempted: it needs a
 *      folded key of `MIN_EDIT_LENGTH`+ characters.
 */
const scoreTerm = (keys: RecordKeys, term: Term): number => {
  let best = NO_MATCH;
  for (let g = 0; g < GROUP_COUNT; g += 1) {
    const tier = literalTier(keys.plain[g], term);
    if (tier === TIER.none) continue;
    if (tier === TIER.token) return packed(TIER.token, g);
    const score = packed(tier, g);
    if (score > best) best = score;
  }
  // A whole synonym word already beats anything folding can offer.
  if (best >= packed(TIER.synonym, GROUP_COUNT - 1)) return best;

  if (term.folds.length > 0) {
    // `stem` first, and against the LITERAL text: the record stores the very
    // word the query folds to, so only one side was normalised.
    if (term.stems.length > 0) {
      for (let g = 0; g < GROUP_COUNT; g += 1) {
        const hay = keys.plain[g];
        if (!hay) continue;
        for (const fold of term.stems) if (hay.includes(fold)) return packed(TIER.stem, g);
      }
    }
    const folded = foldedOf(keys);
    for (let g = 0; g < GROUP_COUNT; g += 1) {
      const hay = folded[g];
      if (!hay) continue;
      for (const fold of term.folds) if (hay.includes(fold)) return packed(TIER.fold, g);
    }
  }

  if (term.edits.length > 0) {
    const buckets = bucketsOf(keys);
    for (let g = 0; g < GROUP_COUNT; g += 1) {
      for (const key of term.edits) if (withinEditBudget(buckets[g], key)) return packed(TIER.near, g);
    }
  }

  return best;
};

/**
 * How well a record answers a compiled query, as one comparable integer, or
 * `NO_MATCH` when a word of the query is not in the record at all.
 *
 * The score is the WEAKEST word's score. Words are still ANDed — "meenakshi
 * madurai" narrows — and a query is only as well answered as its worst-answered
 * word, so a record holding one word in its name and the other buried in prose
 * ranks below one holding both in its name.
 */
export const scoreSite = (site: Searchable, compiled: CompiledQuery): number => {
  const terms = compiled.terms;
  if (terms.length === 0) return 0;
  const keys = keysOf(site);
  let worst = Infinity;
  for (const term of terms) {
    const score = scoreTerm(keys, term);
    if (score === NO_MATCH) return NO_MATCH;
    if (score < worst) worst = score;
  }
  return worst;
};

/**
 * How a record matched a query.
 *
 *   `exact`  — every word appeared as typed, or as a known synonym spelling.
 *   `fuzzy`  — every word was reached, but at least one only through the
 *              transliteration fold in `fuzzy.ts`.
 *   `none`   — at least one word is not in the record at all.
 *
 * Deliberately NOT derivable from `scoreSite`: the ladder ranks a folded whole
 * word ABOVE a literal fragment, so the tiers do not run in order of exactness
 * and the top tier of a two-word match says nothing about the other word. This
 * asks the question it actually means — did every word land literally — which is
 * what `retrieve.ts` reports to the reader as "we did not store your spelling".
 */
export type MatchQuality = "none" | "fuzzy" | "exact";

export const qualityOf = (site: Searchable, compiled: CompiledQuery): MatchQuality => {
  const terms = compiled.terms;
  if (terms.length === 0) return "exact";
  const keys = keysOf(site);
  let literal = true;
  for (const term of terms) {
    const score = scoreTerm(keys, term);
    if (score === NO_MATCH) return "none";
    if (isFolded(tierOf(score))) literal = false;
  }
  return literal ? "exact" : "fuzzy";
};

/** `qualityOf` for a caller holding a raw query string. */
export const matchQuality = (site: Searchable, query: string): MatchQuality =>
  qualityOf(site, compileQuery(query));

/** True when the record answers the query at all, however weakly. */
export const matches = (site: Searchable, query: string): boolean =>
  scoreSite(site, compileQuery(query)) !== NO_MATCH;

// ---------------------------------------------------------------------------
// facets
// ---------------------------------------------------------------------------

export const FACET_KEYS = ["tradition", "country", "state", "era", "circuit", "tier", "deity", "group"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export type FacetCount = { readonly value: string; readonly count: number };
export type Facets = Readonly<Record<FacetKey, readonly FacetCount[]>>;

/** Era name of a record, or "" when its start year falls past the last boundary. */
export const eraName = (site: Pick<Searchable, "built">): string => ERAS[eraIndex(site.built[0])]?.name ?? "";

/**
 * Every facet value a record belongs to. Single-valued except circuits and deity.
 *
 * `deity` and `group` read the generated tags straight off the record. A record
 * whose dedication names no figure carries neither, so it returns [] for both —
 * which is what keeps it out of every deity facet and every deity count, rather
 * than pooling such records under an "unknown" bucket nobody asked for.
 */
const facetValues = (site: Searchable, key: FacetKey): readonly string[] => {
  if (key === "circuit") return site.circuits ?? [];
  if (key === "deity") return site.deities ?? [];
  if (key === "group") return site.deityGroup ? [site.deityGroup] : [];
  if (key === "era") {
    const name = eraName(site);
    return name ? [name] : [];
  }
  const single = key === "tradition" ? site.tradition
    : key === "country" ? site.country
    : key === "state" ? site.state
    : site.tier;
  return single ? [single] : [];
};

const ERA_ORDER = new Map(ERAS.map((era, i) => [era.name, i] as const));

const rank = (key: FacetKey, a: FacetCount, b: FacetCount): number => {
  // Eras read as a timeline; everything else is most-populous first.
  if (key === "era") return (ERA_ORDER.get(a.value) ?? 0) - (ERA_ORDER.get(b.value) ?? 0);
  return b.count - a.count || a.value.localeCompare(b.value);
};

/** Add one record's values for one facet to a running tally. */
const tallyInto = (tally: Map<string, number>, site: Searchable, key: FacetKey): void => {
  for (const value of facetValues(site, key)) tally.set(value, (tally.get(value) ?? 0) + 1);
};

/** Turn the raw tallies into the sorted, rendered facet lists. */
const rankTallies = (tallies: ReadonlyMap<FacetKey, ReadonlyMap<string, number>>): Facets => {
  const out = {} as Record<FacetKey, readonly FacetCount[]>;
  for (const key of FACET_KEYS) {
    out[key] = [...tallies.get(key)!].map(([value, count]) => ({ value, count })).sort((a, b) => rank(key, a, b));
  }
  return out;
};

/**
 * Counts per value for every facet, over exactly the records given.
 *
 * tradition, country, state, era, tier and group are single-valued, so their
 * counts sum to `sites.length` minus the records with no value — and for
 * `group` that shortfall is real and expected: the untagged records have no
 * stream. circuit and deity are multi-valued and may sum higher than
 * `sites.length`, since one record can carry several tags.
 *
 * Kept for callers that already hold a filtered set. A search box wants
 * `filterAndFacet`, which computes the results and all eight facets together.
 */
export const facetsOf = (sites: readonly Searchable[]): Facets => {
  const tallies = new Map<FacetKey, Map<string, number>>(FACET_KEYS.map((key) => [key, new Map()]));
  for (const site of sites) for (const key of FACET_KEYS) tallyInto(tallies.get(key)!, site, key);
  return rankTallies(tallies);
};

/**
 * Group records by the values a selector pulls out of each one, largest group
 * first, ties broken by name.
 *
 * This is what `allDeities()` and `allDeityGroups()` in sites.ts are built from.
 * It lives here, taking its records as an argument, so the grouping the /deities
 * index and the sitemap depend on can be tested against fixtures — sites.ts
 * loads the whole corpus at module scope and cannot be imported by the test
 * runner at all.
 *
 * A record the selector returns [] for joins NO group. That is the untagged
 * case, and it is the reason this takes a selector rather than a field name:
 * "has no value" and "has the empty value" must not collapse into one bucket.
 *
 * The name tiebreak is what makes the order stable across rebuilds, which the
 * sitemap and the static routes both rely on.
 */
export const groupByValues = <T>(
  sites: readonly T[],
  valuesOf: (site: T) => readonly string[],
): [string, T[]][] => {
  const groups = new Map<string, T[]>();
  for (const site of sites) {
    for (const value of valuesOf(site)) {
      if (!value) continue;
      const bucket = groups.get(value);
      if (bucket) bucket.push(site);
      else groups.set(value, [site]);
    }
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
};

/**
 * Which facet dropdowns are worth rendering, given the counts and the query.
 *
 * A facet with fewer than two values cannot narrow anything, so it is hidden —
 * unless it is the one currently in use, which must stay on screen for the
 * reader to be able to clear it.
 *
 * This is the rule that makes the deity facet DISAPPEAR, rather than render
 * empty, on a corpus where no record carries a tag. That is not a hypothetical:
 * it is the state of data/sites.json until the deity-tag branch merges, and it
 * is what a fresh data wave looks like before the tag generator has run. An
 * empty "All deities" dropdown, or one reading "0 results", would be a worse
 * answer than no dropdown at all — it advertises a filter that cannot filter.
 *
 * Exported, and taking its inputs as arguments, so this is testable without
 * mounting the component: see the empty-corpus case in search-index.test.ts.
 */
export const visibleFacetKeys = (
  order: readonly FacetKey[],
  facets: Readonly<Record<FacetKey, readonly FacetCount[]>>,
  query: SearchQuery,
): FacetKey[] => order.filter((key) => facets[key].length > 1 || Boolean(query[key]));

// ---------------------------------------------------------------------------
// filtering
// ---------------------------------------------------------------------------

export type SearchQuery = Readonly<Partial<Record<FacetKey, string>>> & { readonly q?: string };

/** A query with nothing set — the shared empty value for filter state. */
export const EMPTY_QUERY: SearchQuery = Object.freeze({
  q: "", tradition: "", country: "", state: "", era: "", circuit: "", tier: "", deity: "", group: "",
});

/** True when any part of the query would narrow the result set. */
export const isActive = (query: SearchQuery): boolean =>
  Boolean(query.q?.trim()) || FACET_KEYS.some((key) => Boolean(query[key]));

/**
 * Whether a record carries one facet value — without building the list first.
 *
 * `facetValues` allocates an array per record per key, and this runs eight times
 * per record on every keystroke. Same answer, no garbage.
 */
const hasFacetValue = (site: Searchable, key: FacetKey, wanted: string): boolean => {
  if (key === "circuit") return (site.circuits ?? []).includes(wanted);
  if (key === "deity") return (site.deities ?? []).includes(wanted);
  if (key === "group") return site.deityGroup === wanted;
  if (key === "era") return eraName(site) === wanted;
  if (key === "tradition") return site.tradition === wanted;
  if (key === "country") return site.country === wanted;
  if (key === "state") return site.state === wanted;
  return site.tier === wanted;
};

const passesFacets = (site: Searchable, query: SearchQuery): boolean =>
  FACET_KEYS.every((key) => {
    const wanted = query[key];
    return !wanted || hasFacetValue(site, key, wanted);
  });

/** Sort key: strongest match first, corpus order among equals. */
type Scored<T> = { readonly site: T; readonly score: number; readonly index: number };

const byScore = <T>(a: Scored<T>, b: Scored<T>): number => b.score - a.score || a.index - b.index;

/**
 * Records matching every set part of the query, best match first.
 *
 * Ordering is the precedence ladder above: whole word before folded word before
 * prefix before fragment, and within a tier, name before place/deity before
 * dynasty/style before significance. Corpus order breaks the remaining ties, so
 * a query every record answers equally well (the common case, and every
 * facet-only query) comes back in input order, unchanged.
 */
export const filterSites = <T extends Searchable>(sites: readonly T[], query: SearchQuery): T[] => {
  const compiled = compileQuery(query.q ?? "");
  const out: T[] = [];
  if (compiled.terms.length === 0) {
    for (const site of sites) if (passesFacets(site, query)) out.push(site);
    return out;
  }

  const scored: Scored<T>[] = [];
  let ranked = false;
  for (const site of sites) {
    if (!passesFacets(site, query)) continue;
    const score = scoreSite(site, compiled);
    if (score === NO_MATCH) continue;
    if (scored.length > 0 && score !== scored[0].score) ranked = true;
    scored.push({ site, score, index: scored.length });
  }
  // Every match scored the same, so the sort could only shuffle equals.
  if (ranked) scored.sort(byScore);
  for (const entry of scored) out.push(entry.site);
  return out;
};

/**
 * The results AND every facet's counts, in ONE traversal of the corpus.
 *
 * `SiteFilters` used to call `filterSites` nine times per keystroke — once for
 * the results, then once per facet key, because each dropdown's counts are taken
 * against the results of every OTHER active filter (so choosing a deity does not
 * collapse the country list). On the full corpus that was ~21 ms per keystroke
 * on a developer laptop, which is 100–200 ms on the low-end Android this atlas
 * is actually read on — per keystroke, while the reader is still typing.
 *
 * The semantics are IDENTICAL, and the identity that makes one pass enough is
 * this: a record contributes to facet K's counts exactly when it passes the text
 * query and fails no set facet other than K. So count the set facets a record
 * fails, and
 *
 *   0 failures  -> it is a result, and it counts towards EVERY facet
 *   1 failure   -> it counts towards that one facet, and nothing else
 *   2 or more   -> it counts nowhere, and its text is never even scored
 *
 * The facet check runs first because it is cheap and it is what lets the
 * expensive text scoring be skipped entirely for the 2-or-more case.
 */
export type FilteredView<T> = {
  readonly results: T[];
  readonly facets: Facets;
};

export const filterAndFacet = <T extends Searchable>(
  sites: readonly T[],
  query: SearchQuery,
): FilteredView<T> => {
  const compiled = compileQuery(query.q ?? "");
  // Only a facet the reader actually SET can be failed; the rest never narrow.
  const set = FACET_KEYS.filter((key) => Boolean(query[key]));
  const tallies = new Map<FacetKey, Map<string, number>>(FACET_KEYS.map((key) => [key, new Map()]));
  const scored: Scored<T>[] = [];
  let ranked = false;

  for (const site of sites) {
    let failed: FacetKey | null = null;
    let failures = 0;
    for (const key of set) {
      if (hasFacetValue(site, key, query[key]!)) continue;
      failures += 1;
      if (failures > 1) break;
      failed = key;
    }
    if (failures > 1) continue;

    const score = scoreSite(site, compiled);
    if (score === NO_MATCH) continue;

    if (failed !== null) {
      tallyInto(tallies.get(failed)!, site, failed);
      continue;
    }
    for (const key of FACET_KEYS) tallyInto(tallies.get(key)!, site, key);
    if (scored.length > 0 && score !== scored[0].score) ranked = true;
    scored.push({ site, score, index: scored.length });
  }

  if (ranked) scored.sort(byScore);
  return { results: scored.map((entry) => entry.site), facets: rankTallies(tallies) };
};
