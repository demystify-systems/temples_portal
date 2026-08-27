import test from "node:test";
import assert from "node:assert/strict";
import { ERAS, eraIndex, eraOf, appearYear, fmtYear, slugify, gmapsUrl } from "./site-utils.ts";

test("ERAS boundaries ascend and cover the corpus range", () => {
  const tos = ERAS.map((e) => e.to);
  assert.deepEqual(tos, [...tos].sort((a, b) => a - b), "era boundaries must ascend");
  // The corpus spans roughly 650 BCE to the present; the last era must contain it.
  assert.ok(ERAS.at(-1)!.to > 2030);
});

test("eraIndex picks the first era the year precedes", () => {
  assert.equal(eraIndex(-650), 0, "BCE years fall in Ancient");
  assert.equal(eraIndex(549), 0, "just inside Ancient");
  assert.equal(eraIndex(550), 1, "boundaries are upper-exclusive");
  assert.equal(eraIndex(1010), 3 - 1, "Brihadisvara sits in High medieval");
  assert.equal(eraIndex(2026), 5, "present day is Modern");
});

test("eraIndex returns -1 past the final boundary", () => {
  assert.equal(eraIndex(9999), -1);
});

test("eraOf reads the start of the built range, not its end", () => {
  assert.equal(eraOf({ built: [750, 1600] }), eraIndex(750));
});

test("appearYear prefers origin over the built range", () => {
  // A 17th-c. structure attested from the 8th c. should appear at the earlier date.
  assert.equal(appearYear({ built: [1600, 1650], origin: 750 }), 750);
});

test("appearYear falls back to the built range when origin is absent", () => {
  assert.equal(appearYear({ built: [1600, 1650] }), 1600);
});

test("appearYear treats origin 0 as a real year, not as absent", () => {
  // A plain `origin ||` would wrongly fall through to built[0] here.
  assert.equal(appearYear({ built: [500, 600], origin: 0 }), 0);
});

test("fmtYear labels BCE and CE", () => {
  assert.equal(fmtYear(-650), "650 BCE");
  assert.equal(fmtYear(1010), "1010 CE");
  assert.equal(fmtYear(0), "0 CE");
});

test("slugify produces url-safe slugs", () => {
  assert.equal(slugify("Brihadisvara Temple"), "brihadisvara-temple");
  assert.equal(slugify("Shiva & Parvati"), "shiva-and-parvati");
  assert.equal(slugify("  Padmanabhaswamy  "), "padmanabhaswamy");
  assert.equal(slugify("Śrī—Raṅgam!!"), "r-ra-gam", "diacritics are stripped, not transliterated");
});

test("slugify never leaves leading or trailing separators", () => {
  for (const input of ["!!!Temple!!!", "---a---", "& & &x& & &"]) {
    const out = slugify(input);
    assert.ok(!out.startsWith("-") && !out.endsWith("-"), `"${input}" -> "${out}"`);
  }
});

test("gmapsUrl uses coordinates only, storing no Places data (G5)", () => {
  const url = gmapsUrl({ lat: 10.7828, lng: 79.1318 });
  assert.equal(url, "https://www.google.com/maps/search/?api=1&query=10.7828,79.1318");
  assert.ok(!/place_id/.test(url));
});
