import test from "node:test";
import assert from "node:assert/strict";
import {
  retrieve, retrieveById, nearby, circuitMembership, circuitNames,
  distanceKm, relevance, isSourced, sourced, boundedLimit,
  DEFAULT_LIMIT, MAX_LIMIT,
  type AtlasRecord, type RetrievalReason,
} from "./retrieve.ts";

// ---------------------------------------------------------------------------
// fixtures — small and hand-built, so the corpus never enters the test runner
// ---------------------------------------------------------------------------

const mk = (over: Partial<AtlasRecord> & { id: string; name: string }): AtlasRecord => ({
  country: "India",
  place: "Somewhere",
  tradition: "Hindu",
  deity: "Shiva",
  dynasty: "Chola",
  style: "Dravida",
  significance: "A documented history paragraph.",
  built: [1000, 1100],
  builtDisplay: "11th century",
  lat: 10,
  lng: 78,
  sources: [{ l: "Wikipedia", u: "https://en.wikipedia.org/wiki/Example" }],
  ...over,
});

const BRIHADISVARA = mk({
  id: "brihadisvara-thanjavur",
  name: "Brihadisvara Temple",
  native: "பெருவுடையார் கோயில்",
  place: "Thanjavur",
  state: "Tamil Nadu",
  deity: "Shiva (Brihadisvara)",
  lat: 10.7828,
  lng: 79.1318,
  circuits: ["Great Living Chola Temples"],
});

const MEENAKSHI = mk({
  id: "meenakshi-madurai",
  name: "Meenakshi Amman Temple",
  place: "Madurai",
  state: "Tamil Nadu",
  deity: "Meenakshi (Devi)",
  lat: 9.9195,
  lng: 78.1193,
});

// Mentions Thanjavur only in its history paragraph — must rank below a name match.
const AIRAVATESVARA = mk({
  id: "airavatesvara-darasuram",
  name: "Airavatesvara Temple",
  place: "Darasuram",
  state: "Tamil Nadu",
  significance: "A Chola temple near Thanjavur, part of the Great Living Chola Temples.",
  lat: 10.9494,
  lng: 79.3556,
  circuits: ["Great Living Chola Temples"],
});

const UNSOURCED = mk({ id: "unsourced-example", name: "Unsourced Temple", place: "Thanjavur", sources: [] });

const BAIDYANATH = mk({
  id: "baidyanath-deoghar",
  name: "Baidyanath Temple",
  place: "Deoghar",
  state: "Jharkhand",
  lat: 24.4924,
  lng: 86.7,
  circuits: ["Jyotirlinga"],
  disputedCircuits: [{
    circuit: "Jyotirlinga",
    status: "disputed",
    note: "Deoghar and Parli both claim the Vaidyanatha Jyotirlinga.",
    source: "https://en.wikipedia.org/wiki/Vaidyanath_Temple,_Deoghar",
  }],
});

const VAIJNATH = mk({
  id: "vaijnath-parli",
  name: "Vaijnath Temple",
  place: "Parli",
  state: "Maharashtra",
  lat: 18.85,
  lng: 76.53,
  circuits: ["Jyotirlinga"],
  disputedCircuits: [{
    circuit: "Jyotirlinga",
    status: "disputed",
    note: "Parli and Deoghar both claim the Vaidyanatha Jyotirlinga.",
  }],
});

const SOMNATH = mk({ id: "somnath", name: "Somnath Temple", place: "Prabhas Patan", lat: 20.888, lng: 70.401, circuits: ["Jyotirlinga"] });

const CORPUS: readonly AtlasRecord[] = [BRIHADISVARA, MEENAKSHI, AIRAVATESVARA, UNSOURCED, BAIDYANATH, VAIJNATH, SOMNATH];

// ---------------------------------------------------------------------------
// refusal — the success state
// ---------------------------------------------------------------------------

test("a blank query retrieves nothing, which is what drives a refusal", () => {
  const found = retrieve(CORPUS, "   ");
  assert.equal(found.empty, true);
  assert.equal(found.reason, "blank-query");
  assert.deepEqual(found.records, []);
});

test("a question the corpus cannot answer returns empty rather than a near miss", () => {
  // "Angkor Wat" is genuinely absent here. A closest-match fallback would be
  // indistinguishable, to a reader, from an answer.
  const found = retrieve(CORPUS, "Angkor Wat Cambodia");
  assert.equal(found.empty, true);
  assert.equal(found.reason, "no-match");
  assert.equal(found.records.length, 0);
  assert.equal(found.total, 0);
});

test("retrieval never widens a query to salvage a result", () => {
  // Both words exist in the corpus, but never together in one record.
  const found = retrieve(CORPUS, "Meenakshi Deoghar");
  assert.equal(found.empty, true, "AND semantics must hold; no OR fallback");
});

// ---------------------------------------------------------------------------
// the source gate (constitution rule 2)
// ---------------------------------------------------------------------------

test("every retrieved record carries at least one source", () => {
  const found = retrieve(CORPUS, "Thanjavur");
  assert.ok(found.records.length > 0);
  for (const record of found.records) {
    assert.ok(Array.isArray(record.sources) && record.sources.length > 0, `${record.id} has no sources`);
    for (const source of record.sources) {
      assert.ok(source.l && source.u, `${record.id} has an incomplete citation`);
    }
  }
});

test("a record with no sources is invisible to retrieval, by id and by search", () => {
  assert.equal(isSourced(UNSOURCED), false);
  assert.equal(sourced(CORPUS).includes(UNSOURCED), false);
  assert.equal(retrieveById(CORPUS, "unsourced-example"), null);
  const found = retrieve(CORPUS, "Unsourced Temple");
  assert.equal(found.empty, true, "an uncited record must not be quotable");
});

// ---------------------------------------------------------------------------
// matching is delegated to search.ts
// ---------------------------------------------------------------------------

test("search.ts synonym expansion is reused, not reimplemented", () => {
  // "koyil" -> "kovil" -> "temple": the merged synonym group in search.ts.
  assert.equal(retrieve(CORPUS, "Meenakshi koyil").empty, false);
  // Diacritic folding, also search.ts's.
  assert.equal(retrieve(CORPUS, "Brihadīsvara").empty, false);
});

test("deity aliases reach a record whose deity string only names it in parentheses", () => {
  const found = retrieve(CORPUS, "Devi Madurai");
  assert.equal(found.empty, false);
  assert.equal(found.records[0].id, "meenakshi-madurai");
});

test("a native-script query reaches the native field", () => {
  const found = retrieve(CORPUS, "பெருவுடையார்");
  assert.equal(found.empty, false);
  assert.equal(found.records[0].id, "brihadisvara-thanjavur");
});

// ---------------------------------------------------------------------------
// ranking and limits
// ---------------------------------------------------------------------------

test("a name match outranks a mention buried in a history paragraph", () => {
  assert.ok(relevance(BRIHADISVARA, "Brihadisvara") > relevance(AIRAVATESVARA, "Brihadisvara"));
  const found = retrieve(CORPUS, "Thanjavur");
  assert.equal(found.records[0].id, "brihadisvara-thanjavur", "the Thanjavur temple, not the one that mentions it");
});

test("an exact name match scores highest of all", () => {
  assert.equal(relevance(BRIHADISVARA, "brihadisvara temple"), 4);
});

test("limits are bounded so a prompt cannot be talked into unbounded size", () => {
  assert.equal(boundedLimit(undefined), DEFAULT_LIMIT);
  assert.equal(boundedLimit(1000), MAX_LIMIT);
  assert.equal(boundedLimit(0), 1);
  assert.equal(boundedLimit(Number.NaN), 1);
  assert.equal(retrieve(CORPUS, "Temple", {}, 1).records.length, 1);
});

test("total reports every match even when only some are returned", () => {
  const found = retrieve(CORPUS, "Jyotirlinga", {}, 1);
  assert.equal(found.records.length, 1);
  assert.ok(found.total >= 3, `expected all Jyotirlinga records counted, got ${found.total}`);
});

test("facets narrow without a free-text query", () => {
  const found = retrieve(CORPUS, "", { circuit: "Jyotirlinga" });
  assert.equal(found.empty, false);
  assert.deepEqual(found.records.map((r) => r.id).sort(), ["baidyanath-deoghar", "somnath", "vaijnath-parli"]);
});

// ---------------------------------------------------------------------------
// proximity
// ---------------------------------------------------------------------------

test("distanceKm is a great-circle distance, not a coordinate subtraction", () => {
  assert.equal(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
  const km = distanceKm({ lat: 10.7828, lng: 79.1318 }, { lat: 10.9494, lng: 79.3556 });
  assert.ok(km > 25 && km < 35, `Thanjavur to Darasuram should be ~30 km, got ${km}`);
});

test("nearby excludes the anchor, honours the radius and returns nearest first", () => {
  const hits = nearby(CORPUS, BRIHADISVARA, { radiusKm: 200, excludeId: BRIHADISVARA.id });
  assert.ok(!hits.some((hit) => hit.record.id === BRIHADISVARA.id), "the anchor is not near itself");
  assert.equal(hits[0].record.id, "airavatesvara-darasuram");
  assert.deepEqual([...hits].map((h) => h.km).sort((a, b) => a - b), hits.map((h) => h.km));
  assert.ok(hits.every((hit) => hit.km <= 200));
});

test("nearby returns nothing rather than the least-far record when nothing is in range", () => {
  const hits = nearby(CORPUS, BRIHADISVARA, { radiusKm: 5, excludeId: BRIHADISVARA.id });
  assert.deepEqual(hits, []);
});

test("nearby never returns an unsourced record", () => {
  const hits = nearby(CORPUS, { lat: 10, lng: 78 }, { radiusKm: 500 });
  assert.ok(!hits.some((hit) => hit.record.id === "unsourced-example"));
});

// ---------------------------------------------------------------------------
// circuits — contested claims (G10)
// ---------------------------------------------------------------------------

test("a contested circuit member is listed AND flagged, never dropped", () => {
  const members = circuitMembership(CORPUS, "Jyotirlinga");
  const ids = members.map((m) => m.record.id);
  assert.ok(ids.includes("baidyanath-deoghar"), "a contested claimant is still a member");
  assert.ok(ids.includes("vaijnath-parli"), "and so is its rival");

  const contested = members.filter((m) => m.contested);
  assert.equal(contested.length, 2, "both sides of the dispute carry the flag");
  for (const member of contested) {
    assert.ok(member.dispute, "a contested membership must carry its dispute");
    assert.match(member.dispute!.note, /claim/i);
    assert.equal(member.dispute!.status, "disputed");
  }
});

test("an uncontested member of the same circuit is not flagged", () => {
  const somnath = circuitMembership(CORPUS, "Jyotirlinga").find((m) => m.record.id === "somnath");
  assert.ok(somnath);
  assert.equal(somnath!.contested, false);
  assert.equal(somnath!.dispute, null);
});

test("circuit lookup folds case and diacritics but still needs the right circuit", () => {
  assert.equal(circuitMembership(CORPUS, "jyotirlinga").length, 3);
  assert.deepEqual(circuitMembership(CORPUS, "Char Dham"), []);
  assert.deepEqual(circuitMembership(CORPUS, ""), []);
});

test("circuitNames lists what the corpus actually holds, most-claimed first", () => {
  assert.deepEqual(circuitNames(CORPUS), ["Jyotirlinga", "Great Living Chola Temples"]);
});

// ---------------------------------------------------------------------------
// Natural-language phrasing. The assistant shipped refusing "When was the
// Brihadisvara temple at Thanjavur built?" — a record it plainly holds — because
// retrieval ANDed `when`, `was`, `the`, `at` and `built` against a haystack of
// names and places. A chat box receives sentences; a search box receives keywords.

test("a question phrased as a sentence retrieves the record it names", () => {
  const found = retrieve(CORPUS, "When was the Brihadisvara temple at Thanjavur built?", {}, 6);
  assert.equal(found.empty, false, "grammar must not defeat retrieval");
  assert.ok(
    found.records.some((r) => /brihadisvara/i.test(r.name)),
    "the record the question names must be among the results",
  );
});

test("conversational filler is stripped, not searched", () => {
  const bare = retrieve(CORPUS, "Meenakshi", {}, 6);
  const asked = retrieve(CORPUS, "Tell me about the Meenakshi temple please", {}, 6);
  assert.equal(asked.empty, bare.empty);
  assert.deepEqual(
    asked.records.map((r) => r.id),
    bare.records.map((r) => r.id),
    "filler words must not change which records come back",
  );
});

test("a query of pure function words is 'no-terms', refusable for free", () => {
  const found = retrieve(CORPUS, "the was of and in", {}, 6);
  assert.equal(found.empty, true);
  assert.equal(found.reason, "no-terms", "nothing was really asked");
});

test("real terms that simply do not match are 'no-match', not 'no-terms'", () => {
  // The distinction is load-bearing: no-terms refuses without a model call,
  // no-match falls through so findSites can try the entity the AND missed.
  const found = retrieve(CORPUS, "Eiffel Tower Paris", {}, 6);
  assert.equal(found.empty, true);
  assert.equal(found.reason, "no-match", "terms were asked; they just did not match");
});

test("stopword stripping never widens: an out-of-corpus question stays empty", () => {
  // The guard against the fix overshooting. An earlier attempt also dropped
  // zero-match tokens, which threw away `france` and kept `capital` — matching
  // Chola-capital prose and answering a question about France with temples.
  for (const q of ["What is the capital of France?", "Who won the 1998 world cup?"]) {
    assert.equal(retrieve(CORPUS, q, {}, 6).empty, true, `must not invent a match for: ${q}`);
  }
});

// ---------------------------------------------------------------------------
// Relational and superlative questions.
//
// The assistant shipped refusing its OWN placeholder text — "Which Jyotirlinga
// is nearest Ujjain?" — because `nearest` was ANDed against a haystack of names
// and places, matched nothing, and vetoed `jyotirlinga` and `ujjain`, both of
// which the corpus plainly holds. A relation is the SHAPE of a question, not an
// entity: it is answered by the tools (nearby, circuitMembership, the built
// range) FROM the records these words retrieve, never by finding the word
// "nearest" written in a temple's history.
// ---------------------------------------------------------------------------

const MAHAKALESHWAR = mk({
  id: "mahakaleshwar-ujjain",
  name: "Mahakaleshwar Temple",
  place: "Ujjain",
  state: "Madhya Pradesh",
  deity: "Shiva (Mahakal — Lord of Time)",
  lat: 23.1826,
  lng: 75.7682,
  circuits: ["Jyotirlinga", "Maha Shakti Peetha", "Sapta Puri"],
  significance: "The Jyotirlinga of Time itself in Ujjain — ancient Avantika.",
});

const RELATIONAL: readonly AtlasRecord[] = [...CORPUS, MAHAKALESHWAR];

test("the app's own placeholder question retrieves the records it names", () => {
  const found = retrieve(RELATIONAL, "Which Jyotirlinga is nearest Ujjain?", {}, 6);
  assert.equal(found.empty, false, "the corpus holds both Jyotirlinga and Ujjain");
  assert.equal(found.records[0].id, "mahakaleshwar-ujjain");
});

test("superlatives are the shape of the question, not the entity", () => {
  for (const q of [
    "What is the oldest Jyotirlinga?",
    "Which is the largest Jyotirlinga temple?",
    "the most famous Jyotirlinga",
    "list the top Jyotirlinga temples",
    "temples near Ujjain",
  ]) {
    assert.equal(retrieve(RELATIONAL, q, {}, 6).empty, false, `must not be defeated by: ${q}`);
  }
});

test("stripping a relation never invents an entity", () => {
  // `nearest` goes; `paris` stays, matches nothing, and the refusal holds.
  const found = retrieve(RELATIONAL, "Which temple is nearest Paris?", {}, 6);
  assert.equal(found.empty, true);
  assert.equal(found.reason, "no-match");
});

// ---------------------------------------------------------------------------
// Transliteration tolerance, and the line it must not cross.
//
// Measured on the real corpus before this: "where is jaganath temple" returned
// 0 records and was REFUSED; "where is jagannath temple" — one more `n` —
// returned the temple. To a visitor the refusal reads as "we do not hold this
// record", which is the worst thing this product can say about a record it has.
// ---------------------------------------------------------------------------

const JAGANNATH = mk({
  id: "jagannath-puri",
  name: "Shri Jagannath Temple, Puri",
  place: "Puri",
  state: "Odisha",
  deity: "Jagannath (Krishna) with Balabhadra & Subhadra",
  dynasty: "Eastern Ganga",
  lat: 19.8048,
  lng: 85.8179,
  circuits: ["Char Dham"],
  significance: "Eastern seat of the Char Dham, whose wooden deities are unlike any other in Hinduism.",
});

const SPELLING: readonly AtlasRecord[] = [...CORPUS, JAGANNATH];

test("a spelling we do not store still reaches the record we do", () => {
  const asHeard = retrieve(SPELLING, "where is jaganath temple", {}, 6);
  const asStored = retrieve(SPELLING, "where is jagannath temple", {}, 6);
  assert.equal(asHeard.empty, false, "one missing n must not read as 'no such record'");
  assert.equal(asHeard.records[0].id, "jagannath-puri");
  assert.equal(asStored.records[0].id, asHeard.records[0].id, "both spellings reach the same temple");
});

test("a result reached only by folding is reported as the weaker thing it is", () => {
  assert.equal(retrieve(SPELLING, "jaganath", {}, 6).fuzzy, true, "nothing was spelled as we store it");
  assert.equal(retrieve(SPELLING, "jagannath", {}, 6).fuzzy, false, "an exact match was found");
  assert.equal(retrieve(SPELLING, "Brihadisvara", {}, 6).fuzzy, false);
});

test("an exactly spelled record outranks one reached by folding", () => {
  const variant = mk({
    id: "jaganath-deula", name: "Jaganath Deula", place: "Kendrapara", deity: "Krishna",
    significance: "A brick deula.",
  });
  // The variant is FIRST in corpus order, so only the match tier can reorder it.
  const found = retrieve([variant, JAGANNATH], "jagannath", {}, 6);
  assert.deepEqual(found.records.map((r) => r.id), ["jagannath-puri", "jaganath-deula"]);
  assert.equal(found.fuzzy, false, "an exact match exists, so the answer is not a weak one");
});

test("folding is a fallback: it never rescues a query that asked for something else", () => {
  for (const q of ["Angkor Wat Cambodia", "Eiffel Tower Paris", "Machu Picchu Peru"]) {
    assert.equal(retrieve(SPELLING, q, {}, 6).empty, true, `must not fold its way into: ${q}`);
  }
});

// ---------------------------------------------------------------------------
// The regression table.
//
// One list of real questions and what retrieval must do with each. The refusals
// are not an afterthought: a matcher that starts answering them has failed, not
// improved. Both widenings landed together — relational stopwords and the
// transliteration fold — and either one could have bought its recall by
// answering a question about France with temples.
// ---------------------------------------------------------------------------

type Expectation = { readonly q: string; readonly answer: boolean; readonly reason?: RetrievalReason; readonly top?: string };

const QUESTIONS: readonly Expectation[] = [
  // --- must be answered ---
  { q: "where is jaganath temple", answer: true, top: "jagannath-puri" },
  { q: "where is jagannath temple", answer: true, top: "jagannath-puri" },
  { q: "Jagannatha", answer: true, top: "jagannath-puri" },
  { q: "Which Jyotirlinga is nearest Ujjain?", answer: true, top: "mahakaleshwar-ujjain" },
  { q: "What is the oldest temple in Thanjavur?", answer: true },
  { q: "When was the Brihadisvara temple at Thanjavur built?", answer: true, top: "brihadisvara-thanjavur" },
  { q: "How do I reach Kedarnath?", answer: false, reason: "no-match" },
  { q: "Tell me about the Meenakshi temple please", answer: true, top: "meenakshi-madurai" },
  { q: "famous temples in Madurai", answer: true, top: "meenakshi-madurai" },

  // --- must REFUSE ---
  { q: "What is the capital of France?", answer: false, reason: "no-match" },
  { q: "Who won the 1998 world cup?", answer: false, reason: "no-match" },
  { q: "the was of and", answer: false, reason: "no-terms" },
  { q: "   ", answer: false, reason: "blank-query" },
  { q: "Angkor Wat", answer: false, reason: "no-match" },
  { q: "Who is the president of India?", answer: false, reason: "no-match" },
  { q: "nearest largest oldest biggest", answer: false, reason: "no-terms" },
  { q: "What is the best pizza in Naples?", answer: false, reason: "no-match" },
];

const TABLE: readonly AtlasRecord[] = [...CORPUS, MAHAKALESHWAR, JAGANNATH];

for (const { q, answer, reason, top } of QUESTIONS) {
  test(`table: ${answer ? "answers" : `refuses (${reason})`} — ${JSON.stringify(q)}`, () => {
    const found = retrieve(TABLE, q, {}, 6);
    assert.equal(found.empty, !answer, answer ? "the corpus holds this" : "the corpus does not hold this");
    if (reason) assert.equal(found.reason, reason);
    if (top) assert.equal(found.records[0]?.id, top);
    if (!answer) assert.deepEqual(found.records, [], "a refusal carries no records to quote");
  });
}

test("every record in the table can still find itself by its own name", () => {
  // The false-positive guard, in miniature. Measured over the real corpus:
  // 2,793 of 2,796 records rank themselves first and the other 3 rank inside
  // the top six; none is lost and none is refused.
  for (const record of TABLE.filter(isSourced)) {
    const found = retrieve(TABLE, record.name, {}, 6);
    assert.equal(found.empty, false, `${record.id} cannot find itself`);
    assert.equal(found.records[0].id, record.id, `${record.id} is outranked on its own name`);
  }
});

// ---------------------------------------------------------------------------
// The reported ranking bug, end to end.
//
// "thirupathi" answered with Pataleeswarar Temple at Thirupathiripuliyur, and
// only then with Sri Venkateswara Temple at Tirumala. Both records really do
// contain what was asked; the fragment simply contained it as typed while the
// temple that was meant needed the transliteration fold. Ranking every exact
// match above every folded one is what got that backwards.
// ---------------------------------------------------------------------------

const VENKATESWARA = mk({
  id: "venkateswara-tirumala",
  name: "Sri Venkateswara Temple, Tirumala",
  place: "Tirumala, Tirupati",
  state: "Andhra Pradesh",
  deity: "Venkateswara (Vishnu)",
  lat: 13.6833,
  lng: 79.3474,
  significance: "The most-visited pilgrimage site in the world.",
});

const PATALEESWARAR = mk({
  id: "pataleeswarar-cuddalore",
  name: "Pataleeswarar Temple",
  place: "Thirupathiripuliyur, Cuddalore",
  state: "Tamil Nadu",
  deity: "Shiva (Pataleeswarar)",
  lat: 11.7447,
  lng: 79.7681,
  circuits: ["Paadal Petra Sthalam"],
  significance: "A Paadal Petra Sthalam on the north bank of the Gadilam.",
});

// Pataleeswarar FIRST in corpus order, so only the ladder can reorder them.
const SPELLING_TABLE: readonly AtlasRecord[] = [PATALEESWARAR, VENKATESWARA];

test("a folded whole word answers better than an exact fragment of a longer word", () => {
  const found = retrieve(SPELLING_TABLE, "thirupathi", {}, 6);
  assert.deepEqual(
    found.records.map((r) => r.id),
    ["venkateswara-tirumala", "pataleeswarar-cuddalore"],
    "Tirumala is what 'thirupathi' means; Thirupathiripuliyur merely contains the letters",
  );
});

test("the correctly spelled query ranks the same temple first", () => {
  assert.equal(retrieve(SPELLING_TABLE, "tirupati", {}, 6).records[0].id, "venkateswara-tirumala");
});

test("the demoted fragment is still retrievable, never dropped", () => {
  const found = retrieve(SPELLING_TABLE, "thirupathi", {}, 6);
  assert.equal(found.total, 2, "recall is unchanged — only the order moved");
  assert.equal(found.empty, false);
});

test("the ladder is not 'name beats place': a place question still answers with the place", () => {
  assert.equal(retrieve(SPELLING_TABLE, "cuddalore", {}, 6).records[0].id, "pataleeswarar-cuddalore");
  assert.equal(retrieve(SPELLING_TABLE, "tirumala", {}, 6).records[0].id, "venkateswara-tirumala");
});

test("a fragment-only match is still reported as exactly spelled, because it is", () => {
  // `fuzzy` reports whether we had to fold the ASKER's spelling — a separate
  // question from which record ranks first, and it must not drift with the sort.
  assert.equal(retrieve([PATALEESWARAR], "thirupathi", {}, 6).fuzzy, false);
  assert.equal(retrieve([VENKATESWARA], "thirupathi", {}, 6).fuzzy, true);
  assert.equal(retrieve(SPELLING_TABLE, "thirupathi", {}, 6).fuzzy, false, "one record has the letters");
});
