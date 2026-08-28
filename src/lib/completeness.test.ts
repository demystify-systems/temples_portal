import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ABSENCE_CLAIM_WORDS, FIELD_SCALE, completenessOf, resolveTier, hasIndependentSource, listLabels,
  type Recorded,
} from "./completeness.ts";

/** A record that has sourced every field on the scale — flagship by convention (no `tier`). */
const complete: Recorded = {
  deity: "Shiva",
  builtDisplay: "c. 1010 CE",
  dynasty: "Chola",
  style: "Dravidian",
  significance: "Rajaraja I's imperial temple, the high-water mark of Chola architecture.",
  story: "The vimana's shadow is said never to fall on the ground.",
  access: "Thanjavur junction, 2 km; open 06:00–20:30.",
  patron: "Rajaraja I",
  sources: [
    { u: "https://en.wikipedia.org/wiki/Brihadisvara_Temple" },
    { u: "https://whc.unesco.org/en/list/250" },
  ],
};

/** The corpus shape: keeps the whole compact promise, cites Wikipedia alone. */
const compact: Recorded = {
  tier: "compact",
  deity: "Vishnu",
  builtDisplay: "12th century",
  dynasty: "Hoysala",
  style: "Hoysala",
  significance: "A Hoysala foundation recorded in the 1117 CE inscription at the east door.",
  sources: [{ u: "https://en.wikipedia.org/wiki/Chennakesava_Temple" }],
};

test("the scale is nine fields with unique keys, in a fixed order", () => {
  assert.equal(FIELD_SCALE.length, 9);
  assert.equal(new Set(FIELD_SCALE.map((f) => f.key)).size, 9);
  // Order is the contract behind "most useful next"; pin it.
  assert.deepEqual(
    FIELD_SCALE.map((f) => f.key),
    ["significance", "deity", "dating", "dynasty", "style", "access", "story", "patron", "independentSource"],
  );
});

test("a flagship record with every field reports 100%", () => {
  const c = completenessOf(complete);
  assert.equal(c.tier, "flagship");
  assert.equal(c.tierLabel, "Flagship record");
  assert.equal(c.sourcedCount, 9);
  assert.equal(c.total, 9);
  assert.equal(c.pct, 100);
  assert.deepEqual(c.absent, []);
  assert.equal(c.next, null, "nothing is left to ask for");
  assert.ok(c.meetsTier);
});

test("a missing tier means flagship — the corpus convention, not a default of stub", () => {
  assert.equal(resolveTier(undefined), "flagship");
  assert.equal(resolveTier(""), "flagship");
  assert.equal(resolveTier("   "), "flagship");
  assert.equal(resolveTier("Compact"), "compact", "the label is matched case-insensitively");
});

test("a compact record reports exactly the fields it has not sourced", () => {
  const c = completenessOf(compact);
  assert.equal(c.tier, "compact");
  assert.equal(c.tierLabel, "Compact record");
  assert.deepEqual(c.absent.map((f) => f.key), ["access", "story", "patron", "independentSource"]);
  assert.equal(c.sourcedCount, 5);
  assert.equal(c.pct, 56, "5 of 9");
  // It keeps the whole compact promise: everything absent belongs to a deeper tier.
  assert.ok(c.meetsTier, "a compact record is not failing by lacking flagship fields");
  assert.deepEqual(c.promisedAbsent, []);
  assert.deepEqual(c.promised.map((f) => f.key), ["significance", "deity", "dating", "dynasty", "style"]);
});

test("a record below its own tier's promise names the promised field it is missing", () => {
  const c = completenessOf({ ...compact, significance: "" });
  assert.equal(c.meetsTier, false);
  assert.deepEqual(c.promisedAbsent.map((f) => f.key), ["significance"]);
});

test("the next most valuable missing field is deterministic", () => {
  // Same input, same answer — twice, and independent of the object's key order.
  const a = completenessOf(compact);
  const b = completenessOf({ sources: compact.sources, style: compact.style, tier: compact.tier,
    significance: compact.significance, dynasty: compact.dynasty, builtDisplay: compact.builtDisplay,
    deity: compact.deity });
  assert.equal(a.next?.key, "access");
  assert.equal(b.next?.key, "access");

  // The compact essentials outrank the deeper fields: a record missing both is
  // asked for the essential one first.
  assert.equal(completenessOf({ ...compact, deity: "" }).next?.key, "deity");
  assert.equal(completenessOf({ ...compact, significance: "" }).next?.key, "significance");

  // Within the deeper fields the order is access → story → patron → source.
  assert.equal(completenessOf({ ...compact, access: "Bus from Hassan." }).next?.key, "story");
  assert.equal(completenessOf({ ...complete, patron: "", story: "" }).next?.key, "story");
});

test("a record of an unknown tier does not throw and never over-claims", () => {
  const c = completenessOf({ ...compact, tier: "reference-grade" });
  assert.equal(c.recognisedTier, false);
  assert.equal(c.tier, "stub", "an unrecognised label is read as the weakest promise");
  assert.equal(c.tierLabel, "Record", "we do not print a tier name the record never claimed");
  assert.deepEqual(c.promised, [], "a stub promises none of the nine");
  assert.ok(c.meetsTier);
  assert.equal(c.sourcedCount, 5, "what it has sourced is counted regardless of the label");
});

test("an empty record does not throw and reports 0 of 9", () => {
  const c = completenessOf({});
  assert.equal(c.sourcedCount, 0);
  assert.equal(c.pct, 0);
  assert.equal(c.next?.key, "significance");
  assert.equal(c.tier, "flagship", "no tier still means flagship, so the gaps are all named");
  assert.equal(c.meetsTier, false);
});

test("only a non-Wikimedia citation counts as an independent source", () => {
  assert.equal(hasIndependentSource({ sources: [{ u: "https://en.wikipedia.org/wiki/X" }] }), false);
  assert.equal(hasIndependentSource({ sources: [{ u: "https://ta.wikipedia.org/wiki/X" }] }), false);
  assert.equal(hasIndependentSource({ sources: [{ u: "https://www.wikidata.org/wiki/Q1" }] }), false);
  assert.equal(hasIndependentSource({ sources: [{ u: "https://whc.unesco.org/en/list/250" }] }), true);
  assert.equal(hasIndependentSource({ sources: [] }), false);
  assert.equal(hasIndependentSource({}), false);
  assert.equal(hasIndependentSource({ sources: [{ u: "" }] }), false, "an empty url is not a source");
});

test("whitespace is not a sourced field", () => {
  assert.equal(completenessOf({ ...compact, access: "   " }).next?.key, "access");
});

/**
 * The wording rule this feature exists to hold: absence is a statement about our
 * citations, never about the world. These two cases are the reason the module
 * exists at all — styling can regress and be fixed; a page that tells 1,058
 * readers a fact is unknowable has published something we cannot support.
 */
const claimsAbsence = (text: string): string | null => {
  for (const word of ABSENCE_CLAIM_WORDS) {
    if (new RegExp(`\\b${word.replace("/", "\\/")}\\b`, "i").test(text)) return word;
  }
  return null;
};

test("no field label states absence as a fact about the site", () => {
  for (const field of FIELD_SCALE) {
    assert.equal(claimsAbsence(field.label), null, `"${field.label}" claims the fact is absent, not unsourced`);
  }
});

test("the badge copy never states absence as a fact about the site", () => {
  // Comments are stripped first: the rule is explained there in the very words
  // it forbids, and explaining a rule is not breaking it.
  const source = readFileSync(new URL("../app/Completeness.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  const found = claimsAbsence(source);
  assert.equal(found, null, `Completeness.tsx says "${found}" — absence here is ours, not the site's`);
  // …and it must still say the thing that makes the absence ours.
  assert.ok(/not yet sourced/i.test(source), "the badge must frame absence as not yet sourced");
});

test("listLabels reads as a sentence at every length", () => {
  const c = completenessOf(compact);
  assert.equal(listLabels([]), "");
  assert.equal(listLabels(c.absent.slice(0, 1)), "how to reach it");
  assert.equal(listLabels(c.absent.slice(0, 2)), "how to reach it and its sthala katha");
  assert.equal(listLabels(c.absent.slice(0, 3)), "how to reach it, its sthala katha and who paid for it");
});
