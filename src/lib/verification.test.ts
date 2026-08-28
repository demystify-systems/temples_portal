import test from "node:test";
import assert from "node:assert/strict";
import { readVerification, formatStampDate, OVERCLAIM_WORDS } from "./verification.ts";

/** Every distinct `verified` value in the corpus, with its real frequency. */
const CORPUS_VALUES = [
  ["wikipedia-2026-08-27", 2102],
  ["wikipedia-2026-08-28", 760],
  ["wikipedia-2026-08-26", 141],
  ["wikidata-2026-08-27", 24],
  ["wikipedia-corrected-2026-08-26", 2],
  ["curated-unverified", 2],
] as const;

test("an automated stamp is reported as a method and a date, never as a verification", () => {
  const v = readVerification("wikipedia-2026-08-27");
  assert.equal(v.kind, "automated");
  assert.equal(v.source, "Wikipedia");
  assert.equal(v.date, "2026-08-27");
  assert.equal(v.label, "Checked automatically against Wikipedia on 27 Aug 2026.");
});

test("curated-unverified never renders as any kind of verification", () => {
  // UX-SPEC section 2.2: "no record displays the word 'verified' for a
  // curated-unverified value". Two records carry this and both are hand-entered.
  const v = readVerification("curated-unverified");
  assert.equal(v.kind, "unverified");
  assert.match(v.label, /not yet checked/);
  for (const word of OVERCLAIM_WORDS) {
    assert.ok(!v.label.toLowerCase().includes(word), `"${word}" appeared for curated-unverified`);
  }
});

test("no corpus value produces an overclaiming word", () => {
  for (const [value] of CORPUS_VALUES) {
    const { label } = readVerification(value);
    for (const word of OVERCLAIM_WORDS) {
      assert.ok(
        !label.toLowerCase().includes(word),
        `"${value}" produced "${label}", which contains the overclaim "${word}"`,
      );
    }
  }
});

test("a correction is distinguished from a first check", () => {
  const v = readVerification("wikipedia-corrected-2026-08-26");
  assert.equal(v.kind, "corrected");
  assert.equal(v.label, "Corrected against Wikipedia on 26 Aug 2026.");
});

test("wikidata is labelled as itself, not folded into Wikipedia", () => {
  assert.equal(readVerification("wikidata-2026-08-27").source, "Wikidata");
});

test("an absent or unrecognised stamp states that the provenance is unrecorded", () => {
  for (const raw of [undefined, null, "", "   ", "nonsense", "wikipedia-not-a-date"]) {
    const v = readVerification(raw);
    assert.equal(v.kind, "unknown", `${JSON.stringify(raw)} should be unknown`);
    // An absence of provenance is a fact about OUR records, never about the site.
    assert.match(v.label, /not recorded/);
  }
});

test("stamp dates render as a human date, and refuse anything that is not one", () => {
  assert.equal(formatStampDate("2026-08-27"), "27 Aug 2026");
  assert.equal(formatStampDate("2026-01-01"), "1 Jan 2026");
  assert.equal(formatStampDate("2026-13-01"), null, "month 13 is not a date");
  assert.equal(formatStampDate("not-a-date"), null);
  assert.equal(formatStampDate(null), null);
});

test("the corpus is dominated by ONE automated pass, and the copy must not hide it", () => {
  // 2,102 of 3,031 records share a single timestamp. This test exists so that
  // fact stays visible to whoever next edits the copy: it is one script run.
  const [, biggest] = CORPUS_VALUES[0];
  assert.ok(biggest > 2000, "the bulk pass is still the bulk of the corpus");
  assert.equal(readVerification(CORPUS_VALUES[0][0]).kind, "automated");
});
