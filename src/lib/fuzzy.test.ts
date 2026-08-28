import test from "node:test";
import assert from "node:assert/strict";
import {
  phoneticKey, foldPhrase, bucketByLength, hasKey, fuzzyHit, queryKey,
  boundedDistance, editBudget, sharedPrefix, withinEditBudget,
  MIN_EDIT_LENGTH, LONG_EDIT_LENGTH, MAX_EDIT_BUDGET, MIN_PHONETIC_LENGTH,
} from "./fuzzy.ts";
import { normalise } from "./search.ts";

/** Fold a word the way a query reaches this file: normalised first. */
const key = (word: string): string => phoneticKey(normalise(word));

/** Assert a whole family of spellings collapses to one key. */
const foldsTogether = (label: string, spellings: readonly string[]): void => {
  const keys = spellings.map((s) => `${s} -> ${key(s)}`);
  const distinct = new Set(spellings.map(key));
  assert.equal(distinct.size, 1, `${label} must fold to one key, got:\n  ${keys.join("\n  ")}`);
};

// ---------------------------------------------------------------------------
// the fold rules, one at a time
// ---------------------------------------------------------------------------

test("doubled consonants collapse", () => {
  assert.equal(key("jagannath"), key("jaganath"));
  assert.equal(key("mallikarjuna"), key("malikarjuna"));
  assert.equal(key("chidambaram"), key("chiddambaram"));
});

test("aspirate digraphs collapse onto their plain consonant", () => {
  assert.equal(key("bhairava"), key("bairava"));
  assert.equal(key("madhava"), key("madava"));
  assert.equal(key("meghanatha"), key("meganatha"));
  assert.equal(key("khajuraho"), key("kajuraho"));
  assert.equal(key("thanjavur"), key("tanjavur"));
  assert.equal(key("phalgu"), key("falgu"), "ph and f are the same sound to an English speaker");
});

test("v and w are one letter", () => {
  assert.equal(key("vishwanath"), key("vishvanath"));
  assert.equal(key("swami"), key("svami"));
});

test("s, sh and z fold together", () => {
  assert.equal(key("kashi"), key("kasi"));
  assert.equal(key("shakti"), key("sakti"));
  assert.equal(key("mazar"), key("masar"));
});

test("ksh and x meet", () => {
  assert.equal(key("lakshmi"), key("laxmi"));
});

test("long vowels written as digraphs fold to the short vowel", () => {
  assert.equal(key("sreenivasa"), key("srinivasa"), "ee -> i");
  assert.equal(key("choodeshwari"), key("chudeshwari"), "oo -> u");
});

test("a trailing -a or -ah is dropped", () => {
  assert.equal(key("kedarnatha"), key("kedarnath"));
  assert.equal(key("rama"), key("ram"));
  assert.equal(key("shivah"), key("shiva"));
});

test("a trailing -y reads as -i, but a medial y does not", () => {
  assert.equal(key("swamy"), key("swami"));
  assert.equal(key("trichy"), key("trichi"));
  // The reason the rule is only positional: a blanket y -> i folds Surya onto
  // the town of Suri, which is precisely the collision this must not make.
  assert.notEqual(key("surya"), key("suri"));
});

test("a fold never eats a word down to nothing", () => {
  assert.equal(key("aha"), "aha");
  assert.ok(key("rama").length >= 3);
});

test("non-Latin script passes through untouched — there is nothing to romanise", () => {
  assert.equal(phoneticKey("ଜଗନ୍ନାଥ"), "ଜଗନ୍ନାଥ");
  assert.equal(phoneticKey("மீனாட்சி"), "மீனாட்சி");
  assert.equal(phoneticKey("1010"), "1010");
});

// ---------------------------------------------------------------------------
// the families this file exists for — every one meets on the fold ALONE,
// with no edit forgiven. These are the spellings the product owner reported.
// ---------------------------------------------------------------------------

test("the reported transliteration families each fold to a single key", () => {
  foldsTogether("Jagannath", ["Jagannath", "Jaganath", "Jagannatha", "Jagannāth"]);
  foldsTogether("Vishwanath", ["Vishwanath", "Viswanath", "Vishvanath", "Visvanath", "Vishwanatha"]);
  foldsTogether("Kedarnath", ["Kedarnath", "Kedarnatha", "Kedarnāth"]);
  foldsTogether("Brihadisvara", ["Brihadisvara", "Brihadishwara", "Brihadeeswara", "Brihadīsvara"]);
  foldsTogether("Tirupati", ["Tirupati", "Thirupathi", "Tirupathi", "Thirupati"]);
  foldsTogether("Rameswaram", ["Rameswaram", "Rameshwaram", "Ramesvaram", "Rāmeśvaram"]);
  foldsTogether("Kashi", ["Kashi", "Kasi", "Kaashi"]);
});

// ---------------------------------------------------------------------------
// what must NOT fold together — a false positive is worse than a miss
// ---------------------------------------------------------------------------

test("short place names stay distinct", () => {
  const places = ["puri", "pura", "pune", "pali", "bali"];
  assert.equal(new Set(places.map(key)).size, places.length, "puri/pura/pune are three places, not one");
});

test("unrelated deity names stay distinct", () => {
  assert.notEqual(key("shiva"), key("sita"));
  assert.notEqual(key("rama"), key("rani"));
  assert.notEqual(key("chola"), key("chera"));
  assert.notEqual(key("madurai"), key("mathura"));
  assert.notEqual(key("kanchi"), key("kashi"));
});

// ---------------------------------------------------------------------------
// bounded edit distance
// ---------------------------------------------------------------------------

test("boundedDistance measures real edits", () => {
  assert.equal(boundedDistance("temple", "temple", 2), 0);
  assert.equal(boundedDistance("temple", "templo", 2), 1);
  assert.equal(boundedDistance("temple", "temples", 2), 1);
  assert.equal(boundedDistance("temple", "tmple", 2), 1);
});

test("boundedDistance abandons the count once the budget is blown", () => {
  // The exact value past the budget is not meaningful and is not promised —
  // only that it is above it, which is all any caller asks.
  assert.ok(boundedDistance("brihadisvara", "meenakshi", 2) > 2);
  assert.ok(boundedDistance("a", "abcdefgh", 2) > 2, "a length gap alone can exceed the budget");
});

test("boundedDistance is symmetric", () => {
  assert.equal(boundedDistance("visvanat", "visvanatar", 2), boundedDistance("visvanatar", "visvanat", 2));
});

test("editBudget forgives nothing on a short key, one then two as it grows", () => {
  assert.equal(editBudget(MIN_EDIT_LENGTH - 1), 0);
  assert.equal(editBudget(MIN_EDIT_LENGTH), 1);
  assert.equal(editBudget(LONG_EDIT_LENGTH), MAX_EDIT_BUDGET);
  assert.equal(editBudget(0), 0);
  assert.equal(editBudget(4), 0, "puri/pura/pune are one edit apart and must never merge");
});

test("sharedPrefix counts the leading agreement", () => {
  assert.equal(sharedPrefix("brihadisvar", "brihadisvarar"), 11);
  assert.equal(sharedPrefix("vijayaragav", "vijayanagar"), 6);
  assert.equal(sharedPrefix("abc", ""), 0);
});

// ---------------------------------------------------------------------------
// the key index, and the second chance
// ---------------------------------------------------------------------------

const RECORD = normalise("Brihadisvara Temple Peruvudaiyar Kovil Thanjavur Tamil Nadu Chola Dravida Vijayanagara");
const BUCKETS = bucketByLength(RECORD);

test("foldPhrase folds word by word and keeps each word distinct", () => {
  assert.deepEqual(foldPhrase(normalise("Jagannath Temple Puri")), ["jaganat", "temple", "puri"]);
  assert.deepEqual(foldPhrase("   "), []);
});

test("bucketByLength groups every distinct fold by its length", () => {
  assert.ok(hasKey(BUCKETS, key("thanjavur")));
  assert.ok(hasKey(BUCKETS, key("tanjavur")), "a variant spelling reaches the same bucket");
  assert.equal(hasKey(BUCKETS, "notaword"), false);
});

test("the fold matches whole words, never substrings", () => {
  // "Seetha" folds to "sit", which as a SUBSTRING lives inside "situated" and
  // once dragged 119 unrelated records in. Whole words only.
  const prose = bucketByLength(normalise("The temple is situated on a hill"));
  assert.equal(fuzzyHit(prose, "seetha"), "none");
  assert.equal(fuzzyHit(prose, "temple"), "phonetic");
});

test("an edit is forgiven only in the tail of a long word", () => {
  assert.ok(withinEditBudget(BUCKETS, key("brihadeeswarar")), "Brihadeeswarar is Brihadisvara plus a suffix");
  assert.equal(
    withinEditBudget(BUCKETS, key("vijayaraghava")),
    false,
    "Vijayaraghava (a form of Vishnu) is not the Vijayanagara empire",
  );
});

test("fuzzyHit reports HOW a word was reached, strongest first", () => {
  assert.equal(fuzzyHit(BUCKETS, "brihadishwara"), "phonetic", "an identical fold needs no edit");
  assert.equal(fuzzyHit(BUCKETS, "brihadeeswarar"), "edit", "a suffix variant is the weaker second chance");
  assert.equal(fuzzyHit(BUCKETS, "angkor"), "none");
});

test("a word too short to fold safely is not folded at all", () => {
  const short = "ram";
  assert.ok(short.length < MIN_PHONETIC_LENGTH);
  assert.equal(fuzzyHit(bucketByLength(normalise("Rama Temple")), short), "none");
});

// ---------------------------------------------------------------------------
// queryKey — the two length floors, in one place
// ---------------------------------------------------------------------------

test("queryKey folds a word long enough to fold safely", () => {
  assert.equal(queryKey("thirupathi"), phoneticKey("thirupathi"));
  assert.equal(queryKey("jagannath"), queryKey("jaganath"), "both spellings reach one key");
});

test("queryKey refuses a word too short to fold, rather than guessing", () => {
  assert.equal(queryKey("ram"), "", "below MIN_PHONETIC_LENGTH");
  assert.equal(queryKey("sri"), "");
  // No record word folds to "", so "" can never be mistaken for a match.
  assert.equal(bucketByLength(normalise("Rama Temple")).get(0), undefined);
});

test("queryKey and fuzzyHit agree on what is foldable", () => {
  const buckets = bucketByLength(normalise("Tirupati Tirumala"));
  assert.equal(fuzzyHit(buckets, "thirupathi"), "phonetic");
  assert.equal(queryKey("thirupathi"), "tirupati");
  for (const word of ["ram", "sri", "om"]) {
    assert.equal(queryKey(word), "");
    assert.equal(fuzzyHit(buckets, word), "none", "an unfoldable word must reach nothing by folding");
  }
});
