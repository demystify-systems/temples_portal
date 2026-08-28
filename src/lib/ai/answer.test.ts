import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RESULT_CARDS, GAZETTEER_URL, NOTHING_LEFT,
  siteUrl, circuitUrl, dynastyUrl,
  toResult, circuitsOf, toCitations, dedupe, shapeResults,
  segmentsOf, uncitedMentions, reconcile, refusalPayload, buildAnswer,
} from "./answer.ts";
import { slugify } from "../site-utils.ts";
import type { AtlasRecord } from "./retrieve.ts";

// ---------------------------------------------------------------------------
// fixtures — the same shape tools.test.ts uses
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

const KASHI = mk({
  id: "kashi-vishwanath",
  name: "Kashi Vishwanath Temple",
  place: "Varanasi",
  state: "Uttar Pradesh",
  circuits: ["Jyotirlinga"],
  dynasty: "Maratha",
});

/** Contested: Deoghar and Parli both claim the same Jyotirlinga slot. */
const BAIDYANATH = mk({
  id: "baidyanath-deoghar",
  name: "Baidyanath Temple",
  place: "Deoghar",
  state: "Jharkhand",
  circuits: ["Jyotirlinga"],
  disputedCircuits: [{
    circuit: "Jyotirlinga",
    status: "disputed",
    note: "Deoghar and Parli both claim the Vaidyanatha Jyotirlinga.",
    source: "https://en.wikipedia.org/wiki/Vaidyanath_Temple,_Deoghar",
  }],
});

/** A dispute for a circuit the record does not list among its own. */
const NAGESHVARA = mk({
  id: "nageshvara-dwarka",
  name: "Nageshvara Temple",
  place: "Dwarka",
  state: "Gujarat",
  circuits: [],
  disputedCircuits: [{
    circuit: "Jyotirlinga",
    status: "unsourced",
    note: "Three sites claim the Nageshvara Jyotirlinga; no source settles it.",
  }],
});

const SOMNATH = mk({ id: "somnath", name: "Somnath Temple", place: "Prabhas Patan", state: "Gujarat", circuits: ["Jyotirlinga"] });
const MEENAKSHI = mk({ id: "meenakshi-madurai", name: "Meenakshi Amman Temple", place: "Madurai", state: "Tamil Nadu", dynasty: "Nayaka" });
const KONARK = mk({ id: "konark-sun", name: "Konark Sun Temple", place: "Konark", state: "Odisha", dynasty: "Eastern Ganga" });
const AMPERSAND = mk({ id: "shiva-parvati", name: "Shiva & Parvati Temple", circuits: ["Shiva & Parvati Trail"], dynasty: "Chalukya" });

const CORPUS: readonly AtlasRecord[] = [KASHI, BAIDYANATH, NAGESHVARA, SOMNATH, MEENAKSHI, KONARK, AMPERSAND];

// ---------------------------------------------------------------------------
// urls are built from ids, never from text
// ---------------------------------------------------------------------------

test("a site url is built from the record's id", () => {
  assert.equal(siteUrl(KASHI.id), "/site/kashi-vishwanath");
  assert.equal(toResult(KASHI).url, `/site/${KASHI.id}`);
});

test("every card's url is derived from a cited record's id and nothing else", () => {
  const payload = buildAnswer({
    // The prose names only cited records, but it also names things that look
    // like slugs. None of that may reach a URL.
    answer: "Kashi Vishwanath Temple and Somnath Temple. See /site/not-a-real-record for more.",
    cited: [KASHI, SOMNATH],
    corpus: CORPUS,
  });
  const ids = new Set([KASHI.id, SOMNATH.id]);
  assert.equal(payload.results.length, 2);
  for (const result of payload.results) {
    assert.ok(ids.has(result.id), `${result.id} was never cited`);
    assert.equal(result.url, `/site/${result.id}`);
  }
  assert.ok(!payload.results.some((r) => r.url.includes("not-a-real-record")));
});

test("deep links reuse slugify, so they match the circuit and dynasty routes", () => {
  assert.equal(circuitUrl("Shiva & Parvati Trail"), `/circuit/${slugify("Shiva & Parvati Trail")}`);
  assert.equal(circuitUrl("Char Dham"), "/circuit/char-dham");
  assert.equal(dynastyUrl("Eastern Ganga"), "/dynasty/eastern-ganga");

  const card = toResult(AMPERSAND);
  assert.equal(card.dynasty?.url, "/dynasty/chalukya");
  assert.equal(card.circuits[0]?.url, "/circuit/shiva-and-parvati-trail");
});

test("an unsluggable name produces no link rather than a link to nowhere", () => {
  const card = toResult(mk({ id: "punct", name: "Punctuation", dynasty: "???", circuits: ["!!!"] }));
  assert.equal(card.dynasty, undefined);
  assert.deepEqual(card.circuits, []);
});

test("a card carries the specified fields", () => {
  const card = toResult(KASHI);
  assert.equal(card.name, "Kashi Vishwanath Temple");
  assert.equal(card.place, "Varanasi");
  assert.equal(card.state, "Uttar Pradesh");
  assert.equal(card.country, "India");
  assert.equal(card.builtDisplay, "11th century");
  assert.equal(card.tradition, "Hindu");
  assert.equal(card.url, "/site/kashi-vishwanath");
});

// ---------------------------------------------------------------------------
// contested attributions survive into the card
// ---------------------------------------------------------------------------

test("a contested membership is reported as contested on the card", () => {
  const card = toResult(BAIDYANATH);
  assert.equal(card.contested, true);
  const jyotirlinga = card.circuits.find((c) => c.name === "Jyotirlinga");
  assert.ok(jyotirlinga, "the circuit must still be shown");
  assert.equal(jyotirlinga!.contested, true);
  assert.equal(jyotirlinga!.status, "disputed");
  assert.match(jyotirlinga!.note!, /both claim the Vaidyanatha Jyotirlinga/);
  assert.equal(jyotirlinga!.source, "https://en.wikipedia.org/wiki/Vaidyanath_Temple,_Deoghar");
});

test("an uncontested membership is not marked contested", () => {
  const jyotirlinga = toResult(SOMNATH).circuits.find((c) => c.name === "Jyotirlinga");
  assert.equal(jyotirlinga?.contested, false);
  assert.equal(jyotirlinga?.note, undefined);
  assert.equal(toResult(SOMNATH).contested, false);
});

test("a dispute over a circuit the record does not list is still surfaced", () => {
  // Hiding it would be the assistant settling a disagreement the atlas leaves open.
  const circuits = circuitsOf(NAGESHVARA);
  assert.equal(circuits.length, 1);
  assert.equal(circuits[0]!.name, "Jyotirlinga");
  assert.equal(circuits[0]!.contested, true);
  assert.equal(circuits[0]!.status, "unsourced");
});

test("the dispute reaches the payload, not just the record", () => {
  const payload = buildAnswer({ answer: "Baidyanath Temple is at Deoghar.", cited: [BAIDYANATH], corpus: CORPUS });
  assert.equal(payload.results[0]?.contested, true);
  assert.equal(payload.results[0]?.circuits[0]?.contested, true);
});

// ---------------------------------------------------------------------------
// the cap, and honest arithmetic at its boundary
// ---------------------------------------------------------------------------

const many = (n: number): AtlasRecord[] =>
  Array.from({ length: n }, (_, i) => mk({ id: `site-${i}`, name: `Temple Number ${i}` }));

test("no 'more' link when the cited set is exactly at the cap", () => {
  const shaped = shapeResults(many(MAX_RESULT_CARDS), MAX_RESULT_CARDS);
  assert.equal(shaped.results.length, MAX_RESULT_CARDS);
  assert.equal(shaped.total, MAX_RESULT_CARDS);
  assert.equal(shaped.more, null, "a '0 more' link is a lie about the cap");
});

test("one over the cap hides exactly one", () => {
  const shaped = shapeResults(many(MAX_RESULT_CARDS + 1), MAX_RESULT_CARDS);
  assert.equal(shaped.results.length, MAX_RESULT_CARDS);
  assert.equal(shaped.total, MAX_RESULT_CARDS + 1);
  assert.deepEqual(shaped.more, { count: 1, url: GAZETTEER_URL });
});

test("'and N more' counts every record the cap hid", () => {
  const shaped = shapeResults(many(20), 4);
  assert.equal(shaped.results.length, 4);
  assert.deepEqual(shaped.more, { count: 16, url: GAZETTEER_URL });
  assert.equal(shaped.results.length + shaped.more!.count, shaped.total);
});

test("under the cap shows everything and hides nothing", () => {
  const shaped = shapeResults(many(2), MAX_RESULT_CARDS);
  assert.equal(shaped.results.length, 2);
  assert.equal(shaped.more, null);
});

test("duplicates are counted once, so 'more' cannot overstate the atlas", () => {
  const shaped = shapeResults([KASHI, KASHI, SOMNATH, KASHI], 1);
  assert.equal(shaped.total, 2);
  assert.deepEqual(shaped.more, { count: 1, url: GAZETTEER_URL });
  assert.equal(dedupe([KASHI, KASHI]).length, 1);
});

test("the cap survives nonsense input rather than emitting negative counts", () => {
  assert.equal(shapeResults(many(3), -5).results.length, 0);
  assert.deepEqual(shapeResults(many(3), -5).more, { count: 3, url: GAZETTEER_URL });
  assert.equal(shapeResults(many(3), Number.NaN).results.length, 3);
});

// ---------------------------------------------------------------------------
// a refusal has no cards
// ---------------------------------------------------------------------------

test("an explicit refusal produces zero cards and zero citations", () => {
  const payload = buildAnswer({ answer: "I don't have a sourced answer for that.", cited: [], refused: true });
  assert.equal(payload.refused, true);
  assert.deepEqual(payload.results, []);
  assert.deepEqual(payload.citations, []);
  assert.equal(payload.resultsTotal, 0);
  assert.equal(payload.more, null);
});

test("a refusal with records still in hand shows no cards", () => {
  // The route refuses before any tool ran; nothing was asserted, so nothing links.
  const payload = buildAnswer({ answer: "No sourced answer.", cited: [KASHI, SOMNATH], refused: true, corpus: CORPUS });
  assert.deepEqual(payload.results, []);
  assert.deepEqual(payload.citations, []);
});

test("nothing cited is a refusal even when the model wrote prose", () => {
  const payload = buildAnswer({ answer: "The temple is very old.", cited: [], corpus: CORPUS });
  assert.equal(payload.refused, true);
  assert.deepEqual(payload.results, []);
  assert.deepEqual(payload.citations, []);
});

test("refusalPayload is the shape the interface can render its note beside", () => {
  const payload = refusalPayload("nope");
  assert.equal(payload.answer, "nope");
  assert.equal(payload.refused, true);
  assert.equal(payload.results.length, 0);
  assert.equal(payload.citations.length, 0);
});

// ---------------------------------------------------------------------------
// no card for a record the tools did not return
// ---------------------------------------------------------------------------

test("a record in the corpus but not in the cited set never becomes a card", () => {
  const payload = buildAnswer({ answer: "Somnath Temple stands at Prabhas Patan.", cited: [SOMNATH], corpus: CORPUS });
  const ids = payload.results.map((r) => r.id);
  assert.deepEqual(ids, ["somnath"]);
  for (const record of CORPUS) {
    if (record.id === "somnath") continue;
    assert.ok(!ids.includes(record.id), `${record.id} was never returned by a tool`);
  }
});

test("citations and cards are drawn from the same cited set", () => {
  const payload = buildAnswer({ answer: "Somnath Temple and Kashi Vishwanath Temple.", cited: [SOMNATH, KASHI], corpus: CORPUS });
  assert.deepEqual(payload.citations.map((c) => c.id), payload.results.map((r) => r.id));
  assert.deepEqual(payload.citations.map((c) => c.url), payload.results.map((r) => r.url));
});

test("a citation keeps its record's own sources", () => {
  assert.deepEqual(toCitations([KASHI])[0]!.sources, KASHI.sources);
  assert.equal(toCitations([KASHI])[0]!.place, "Varanasi, Uttar Pradesh, India");
});

// ---------------------------------------------------------------------------
// prose and cards must not contradict each other
// ---------------------------------------------------------------------------

test("segmentsOf keeps every character, terminators and dandas included", () => {
  const text = "One. Two! Three? चार। पाँच॥";
  assert.equal(segmentsOf(text).join(""), text);
  assert.ok(segmentsOf(text).length >= 5);
});

test("prose naming only cited records is left untouched", () => {
  const prose = "Somnath Temple stands at Prabhas Patan in Gujarat.";
  const out = reconcile(prose, [SOMNATH], CORPUS);
  assert.equal(out.text, prose);
  assert.deepEqual(out.dropped, []);
  assert.equal(out.emptied, false);
});

test("a record named in prose but never retrieved is detected", () => {
  const flagged = uncitedMentions("Somnath Temple is nearby. Meenakshi Amman Temple is at Madurai.", [SOMNATH], CORPUS);
  assert.deepEqual(flagged.map((m) => m.id), ["meenakshi-madurai"]);
});

test("the claim is dropped rather than shipped as a mismatch", () => {
  const out = reconcile(
    "Somnath Temple stands at Prabhas Patan. Meenakshi Amman Temple is at Madurai.",
    [SOMNATH],
    CORPUS,
  );
  assert.equal(out.text, "Somnath Temple stands at Prabhas Patan.");
  assert.deepEqual(out.dropped, ["Meenakshi Amman Temple"]);
  assert.equal(out.emptied, false);
});

test("the dropped claim never becomes a card, and the payload says what went", () => {
  const payload = buildAnswer({
    answer: "Somnath Temple stands at Prabhas Patan. Konark Sun Temple is in Odisha.",
    cited: [SOMNATH],
    corpus: CORPUS,
  });
  assert.equal(payload.answer, "Somnath Temple stands at Prabhas Patan.");
  assert.deepEqual(payload.results.map((r) => r.id), ["somnath"]);
  assert.deepEqual(payload.dropped, ["Konark Sun Temple"]);
  assert.ok(!payload.answer.includes("Konark"));
});

test("an answer that is entirely unsupported collapses to a refusal", () => {
  const payload = buildAnswer({
    answer: "Meenakshi Amman Temple is at Madurai.",
    cited: [SOMNATH],
    corpus: CORPUS,
    refusalText: "No sourced answer.",
  });
  assert.equal(payload.refused, true);
  assert.equal(payload.answer, "No sourced answer.");
  assert.deepEqual(payload.results, []);
  assert.deepEqual(payload.dropped, ["Meenakshi Amman Temple"]);
});

test("the collapse has a refusal of its own when the caller supplies none", () => {
  const payload = buildAnswer({ answer: "Konark Sun Temple is in Odisha.", cited: [SOMNATH], corpus: CORPUS });
  assert.equal(payload.answer, NOTHING_LEFT);
  assert.equal(payload.refused, true);
});

test("a name shared with a cited record's own text is not treated as a stray mention", () => {
  // "Somnath Temple" is the cited record; a corpus record named "Somnath" alone
  // must not make the sentence look like a fabrication.
  const corpus = [...CORPUS, mk({ id: "somnath-town", name: "Somnath" })];
  assert.deepEqual(uncitedMentions("Somnath Temple is in Gujarat.", [SOMNATH], corpus), []);
});

test("short names are never treated as mentions", () => {
  const corpus = [mk({ id: "sun", name: "Sun" })];
  assert.deepEqual(uncitedMentions("The Sun rises over the tank.", [SOMNATH], corpus), []);
});

test("diacritics and case do not hide a mention", () => {
  const corpus = [...CORPUS, mk({ id: "srirangam", name: "Ranganathaswamy" })];
  const flagged = uncitedMentions("Raṅganāthaswamy is at Srirangam.", [SOMNATH], corpus);
  assert.deepEqual(flagged.map((m) => m.id), ["srirangam"]);
});

test("a mention must be a whole word, not a fragment of one", () => {
  const corpus = [mk({ id: "ranga", name: "Rangana" })];
  assert.deepEqual(uncitedMentions("Ranganathaswamy is at Srirangam.", [SOMNATH], corpus), []);
});

test("dropping works across dandas as well as full stops", () => {
  const out = reconcile("सोमनाथ मंदिर गुजरात में है। Konark Sun Temple is in Odisha।", [SOMNATH], CORPUS);
  assert.ok(!out.text.includes("Konark"));
  assert.ok(out.text.includes("सोमनाथ"));
});

test("an empty answer is not mistaken for a mention-free one", () => {
  assert.deepEqual(uncitedMentions("", [SOMNATH], CORPUS), []);
  assert.deepEqual(uncitedMentions("   ", [SOMNATH], CORPUS), []);
});

test("with no corpus supplied the cited set is the only yardstick", () => {
  // Nothing outside the cited set is knowable, so nothing is dropped.
  const payload = buildAnswer({ answer: "Somnath Temple and something else entirely.", cited: [SOMNATH] });
  assert.deepEqual(payload.dropped, []);
  assert.equal(payload.refused, false);
});
