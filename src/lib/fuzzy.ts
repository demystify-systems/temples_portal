/**
 * Transliteration-tolerant matching for Indic romanisation.
 *
 * A visitor types what they heard. "Jaganath", "Jagannath" and "Jagannatha" are
 * the same temple; so are Vishwanath / Viswanath / Vishvanath, Kedarnath /
 * Kedarnatha, Brihadisvara / Brihadishwara / Brihadeeswarar, Tirupati /
 * Thirupathi, Rameswaram / Rameshwaram. There is no single English spelling of
 * a Sanskrit or Tamil name, and refusing a spelling we do not happen to store
 * reads to the asker as "the atlas does not hold this record".
 *
 * SCOPE. This file is query-side spelling knowledge, exactly like SYNONYM_GROUPS
 * in `search.ts` — it widens what a user may type to reach a record and never
 * changes, infers or adds what the record says (constitution rule 2).
 *
 * TWO MECHANISMS, IN ORDER OF CONFIDENCE.
 *
 *   1. A **phonetic fold** (`phoneticKey`). A deterministic rewrite that
 *      collapses the variation romanisation actually produces — doubled
 *      consonants, aspirate digraphs, v/w, s/sh/z, ksh/x, ee/i, oo/u, a
 *      trailing -a/-ah/-s and a trailing -y/-i. Two spellings of one name fold
 *      to one key. This is a rewrite, not a similarity score: it has no
 *      threshold to tune and it cannot drift. On this corpus it carries almost
 *      all the work — every family in the bug report meets here, unaided.
 *
 *   2. **Bounded edit distance** (`boundedDistance`), as a SECOND chance only,
 *      over folded keys, and only when both are long enough that one edit
 *      cannot change which word was meant (`MIN_EDIT_LENGTH`), and only when
 *      the edits fall in the word's tail (`tailOnly`). Nothing is forgiven on a
 *      short key: "puri", "pura" and "pune" are three different places and no
 *      amount of closeness makes them one.
 *
 * Neither mechanism is ever a replacement for an exact or synonym match. See
 * `matchQuality` in `search.ts`: a record reached only this way is reported as a
 * weaker result and always ranks below one that matched as typed.
 *
 * Pure functions only, and no caching of anything keyed on a record — the
 * per-record indexes live in `search.ts` alongside the haystack cache.
 */

// ---------------------------------------------------------------------------
// the phonetic fold
// ---------------------------------------------------------------------------

/**
 * Folding rules are about the Latin alphabet. `normalise` in search.ts
 * deliberately keeps Devanagari, Tamil and every other script intact, and those
 * tokens must pass through untouched: a Tamil query already matches the
 * `native` field exactly, and there is nothing to romanise.
 */
const LATIN_WORD = /^[a-z]+$/;

/**
 * Consonant rewrites, applied in this order. Order is load-bearing:
 *
 *  - `chh` before `ch`, so the trigraph does not leave a stray `h`.
 *  - `sh` before `x`, so "Lakshmi" -> "laksmi" and "Laxmi" -> "laksmi" meet.
 *  - the aspirate digraphs before the trailing-`h` trim, so "Kedarnath" has
 *    already become "kedarnat" and the trim has nothing left to do.
 *
 * `ph -> f` rather than `-> p`: an English speaker writes the aspirate as `f`
 * ("Falgu"/"Phalgu"), which is the variation actually seen. `c` is otherwise
 * left alone — no `c -> k` rule — because "Chola"/"Kola" are not variants of
 * each other and merging them would buy nothing for a real query.
 */
const CONSONANT_RULES: readonly (readonly [RegExp, string])[] = [
  [/chh/g, "c"],
  [/ch/g, "c"],
  [/sh/g, "s"],
  [/zh/g, "s"],
  [/jh/g, "j"],
  [/bh/g, "b"],
  [/dh/g, "d"],
  [/gh/g, "g"],
  [/kh/g, "k"],
  [/ph/g, "f"],
  [/th/g, "t"],
  [/ck/g, "k"],
  [/x/g, "ks"],
  [/q/g, "k"],
  [/w/g, "v"],
  [/z/g, "s"],
];

/** Long vowels written as digraphs. Run after the consonants, before the dedupe. */
const VOWEL_RULES: readonly (readonly [RegExp, string])[] = [
  [/ee/g, "i"],
  [/oo/g, "u"],
];

/**
 * `y` folds to `i` only in final position ("Swamy"/"Swami", "Trichy"/"Trichi").
 *
 * A blanket y->i would fold "Surya" to "suri" and collide it with the town Suri,
 * which is exactly the class of false positive this product cannot afford. In
 * medial position the two spellings are still one edit apart ("ayody"/"ayodi"
 * for Ayodhya/Ayodhia), so rule 2 catches them without the collision.
 */
const TRAILING_Y = /y$/;

/** Any run of one repeated letter collapses to one: nn/n, tt/t, ll/l, aa/a. */
const DOUBLED = /(.)\1+/g;

/** Below this a fold must not eat the word: "aha" stays "aha", "rama" -> "ram". */
const MIN_STEM = 3;

/**
 * Trailing `-h`, then `-a`, then `-s`, so Kedarnath / Kedarnatha / Kedarnathā
 * end at the same stem, and so does an English plural: a chat box receives
 * "temples near Ujjain" as often as "temple", and "temples" matching nothing
 * refuses a question about records we hold. Applied last, and never below
 * `MIN_STEM` characters.
 */
const TAIL_ORDER = ["h", "a", "s"] as const;

const trimTail = (key: string): string =>
  TAIL_ORDER.reduce<string>(
    (stem, tail) => (stem.length > MIN_STEM && stem.endsWith(tail) ? stem.slice(0, -1) : stem),
    key,
  );

const fold = (token: string): string => {
  if (!LATIN_WORD.test(token)) return token;
  const consonants = CONSONANT_RULES.reduce<string>((acc, [rule, to]) => acc.replace(rule, to), token);
  const vowels = VOWEL_RULES.reduce<string>((acc, [rule, to]) => acc.replace(rule, to), consonants);
  return trimTail(vowels.replace(TRAILING_Y, "i").replace(DOUBLED, "$1"));
};

/**
 * Distinct words across a 2,791-record corpus number in the tens of thousands
 * and every one of them is folded on every fuzzy query, so the rewrite is
 * memoised by token. Cleared wholesale rather than evicted one at a time: this
 * is a hit-rate optimisation, not a correctness mechanism.
 */
const KEY_CACHE_LIMIT = 60_000;
const keyCache = new Map<string, string>();

/**
 * The comparable form of one already-normalised word: lowercase, diacritic-free
 * (see `normalise` in search.ts) and folded to its romanisation-independent
 * stem. "jaganath", "jagannath" and "jagannatha" all return "jaganat".
 */
export const phoneticKey = (token: string): string => {
  const cached = keyCache.get(token);
  if (cached !== undefined) return cached;
  const key = fold(token);
  if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.clear();
  keyCache.set(token, key);
  return key;
};

/** Every distinct fold of the words in an already-normalised phrase. */
export const foldPhrase = (normalised: string): readonly string[] =>
  [...new Set(normalised.split(" ").filter(Boolean).map(phoneticKey))];

// ---------------------------------------------------------------------------
// bounded edit distance — the second chance, never the first
// ---------------------------------------------------------------------------

/** Shortest query word the phonetic fold is allowed to be applied to. */
export const MIN_PHONETIC_LENGTH = 4;
/**
 * Shortest folded key an edit may be forgiven on, and the length from which a
 * second is. Both are stated on the FOLDED key, which the rules above typically
 * make one to two characters shorter than the word as typed.
 *
 * Measured on this corpus, not guessed. At folded length five and six a single
 * edit routinely changes which word was meant — "vimal" (Vimala Temple) and
 * "viman" (vimana, the tower over a sanctum); "kalink" (Kalinka Temple) and
 * "kaling" (the Kalinga country); "nepal" and "nepali" — and those three
 * queries alone dragged in 240 unrelated records.
 *
 * Raising the floor to seven, together with `tailOnly`, took the corpus-wide
 * count of edit-forgiven record hits from 25,424 to 3,383, and lost nothing:
 * every spelling this file exists to catch (jaganath, viswanath, kedarnatha,
 * thirupathi, rameshwaram, kasi, laxmi, sreenivasa, brihadishwara) already
 * meets its sibling on the fold itself, with no edit forgiven at all. Only
 * suffix variants that survive the fold — Brihadeeswarar against Brihadisvara,
 * Viswanathar against Vishwanath — need this tier at all.
 */
export const MIN_EDIT_LENGTH = 7;
export const LONG_EDIT_LENGTH = 8;
/** Ceiling on any budget — used to bound the length buckets scanned. */
export const MAX_EDIT_BUDGET = 2;

/**
 * Edits forgiven between two folded keys of the given length. Deliberately zero
 * below `MIN_EDIT_LENGTH`: on a short key one edit reaches a great many
 * unrelated words, and this corpus is full of short ones.
 */
export const editBudget = (length: number): number => {
  if (length >= LONG_EDIT_LENGTH) return MAX_EDIT_BUDGET;
  if (length >= MIN_EDIT_LENGTH) return 1;
  return 0;
};

/**
 * Levenshtein distance, abandoned as soon as it is known to exceed `max`.
 *
 * Returns `max + 1` rather than the true distance once the budget is blown —
 * callers only ever ask "is this within budget", and the early exit is what
 * makes a corpus-wide scan affordable.
 */
export const boundedDistance = (a: string, b: string, max: number): number => {
  if (a === b) return 0;
  if (max <= 0) return 1;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (long.length - short.length > max) return max + 1;

  let previous = Array.from({ length: short.length + 1 }, (_, i) => i);
  for (let i = 1; i <= long.length; i += 1) {
    const current = new Array<number>(short.length + 1);
    current[0] = i;
    let best = i;
    for (let j = 1; j <= short.length; j += 1) {
      const substitution = previous[j - 1] + (long[i - 1] === short[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      if (current[j] < best) best = current[j];
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[short.length];
};

// ---------------------------------------------------------------------------
// the per-record key index
// ---------------------------------------------------------------------------

/**
 * A record's folded words, grouped by length.
 *
 * Grouped rather than held as one set because the edit pass only ever compares
 * keys whose lengths are within budget of each other: without the buckets a
 * single fuzzy query walks every word of every record, with them it walks five
 * short lists. Membership (the phonetic pass) is a lookup in one bucket.
 */
export type KeyBuckets = ReadonlyMap<number, readonly string[]>;

/** Build the buckets from an already-normalised phrase. */
export const bucketByLength = (normalised: string): KeyBuckets => {
  const buckets = new Map<number, string[]>();
  for (const key of foldPhrase(normalised)) {
    const bucket = buckets.get(key.length);
    if (bucket) bucket.push(key);
    else buckets.set(key.length, [key]);
  }
  return buckets;
};

/** True when the record contains a WHOLE word that folds to exactly `key`. */
export const hasKey = (buckets: KeyBuckets, key: string): boolean =>
  (buckets.get(key.length) ?? []).includes(key);

/** How many leading characters two keys agree on. */
export const sharedPrefix = (a: string, b: string): number => {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
};

/**
 * Whether every forgiven edit falls in the TAIL of the shorter key — i.e. the
 * two keys agree on all but `budget` of the shorter one's leading characters.
 *
 * Romanisation varies in the ending, not the opening: Brihadisvara /
 * Brihadeeswarar fold to "brihadisvar" and "brihadisvarar", agreeing on all
 * eleven; Vishwanath / Viswanathar to "visvanat" and "visvanatar", agreeing on
 * all eight. Two edits scattered through the MIDDLE of a word mean a different
 * word — "vijayaragav" (Vijayaraghava, a form of Vishnu) and "vijayanagar" (the
 * empire) are two substitutions apart and share only six leading characters,
 * and merging them is exactly the false positive this product cannot afford.
 */
const tailOnly = (a: string, b: string, budget: number): boolean =>
  sharedPrefix(a, b) >= Math.min(a.length, b.length) - budget;

/**
 * True when some key in `buckets` is within its own edit budget of `key`.
 *
 * The budget is taken from the SHORTER of the two keys, so a long record word
 * never lends its generous budget to a short query word.
 */
export const withinEditBudget = (buckets: KeyBuckets, key: string): boolean => {
  if (key.length < MIN_EDIT_LENGTH) return false;
  for (let length = key.length - MAX_EDIT_BUDGET; length <= key.length + MAX_EDIT_BUDGET; length += 1) {
    for (const candidate of buckets.get(length) ?? []) {
      const budget = editBudget(Math.min(key.length, candidate.length));
      if (budget === 0 || !tailOnly(key, candidate, budget)) continue;
      if (boundedDistance(key, candidate, budget) <= budget) return true;
    }
  }
  return false;
};

/**
 * Whether a query word reaches a record's folded text, and how.
 *
 * `"none"` is a real answer and the common one: most words that do not match
 * exactly are simply not in the record.
 */
export type FuzzyHit = "none" | "phonetic" | "edit";

/**
 * The fold of a QUERY word, or `""` when the word is too short to fold safely.
 *
 * Both length floors live here, beside the rules they guard: a word shorter than
 * `MIN_PHONETIC_LENGTH` is not folded at all, and a fold that collapsed below
 * `MIN_STEM` is not a stem, it is a fragment. `""` is the honest answer for both
 * — a caller that treats it as "no fold to try" cannot accidentally match on it,
 * because no record word folds to the empty string either.
 *
 * Exported so `search.ts` can fold a query word ONCE per search rather than once
 * per record: the ladder there tries every field group of every record against
 * the same key, and re-deriving it 2,796 times is pure waste.
 */
export const queryKey = (token: string): string => {
  if (token.length < MIN_PHONETIC_LENGTH) return "";
  const key = phoneticKey(token);
  return key.length < MIN_STEM ? "" : key;
};

/**
 * The fuzzy fallback for a single normalised query word, in order of confidence:
 * an identical fold first, an edit-budget neighbour second.
 *
 * WHOLE WORDS, not substrings. `search.ts` matches exact text by substring —
 * typing "meena" finds Meenakshi — but the same rule on a FOLDED key is far too
 * loose, because the fold shortens: "Seetha" folds to "sit", which as a
 * substring appears inside "situated" and dragged 119 unrelated records into a
 * measured run. Requiring a whole folded word costs nothing real (a misspelled
 * prefix is still one edit away, which the second tier catches) and removes
 * that entire class of false positive.
 */
export const fuzzyHit = (buckets: KeyBuckets, token: string): FuzzyHit => {
  const key = queryKey(token);
  if (!key) return "none";
  if (hasKey(buckets, key)) return "phonetic";
  return withinEditBudget(buckets, key) ? "edit" : "none";
};
