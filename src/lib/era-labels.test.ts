import test from "node:test";
import assert from "node:assert/strict";

import { distinctEraLabels } from "./era-labels.ts";
import { ERAS } from "./site-utils.ts";
import { UI_TRANSLATIONS, TRANSLATED_LANGUAGES } from "./generated/ui-translations.ts";
import type { UiKey } from "./ui-strings.ts";

const ENGLISH = ERAS.map((e) => e.name);

test("distinct translations are left alone", () => {
  const given = ["Prachin", "Purva", "Uchcha", "Uttar", "AadhunikA", "AadhunikB"];
  assert.deepEqual(distinctEraLabels(given, ENGLISH), given);
});

test("a colliding pair falls back to English — both of them, not one", () => {
  // Arrange: "Early medieval" and "High medieval" both came back as one word.
  const given = ["Prachin", "Madhya", "Madhya", "Uttar", "Aadhunik", "Naveen"];
  // Act
  const out = distinctEraLabels(given, ENGLISH);
  // Assert: keeping either one would silently mislabel the other era.
  assert.equal(out[1], "Early medieval");
  assert.equal(out[2], "High medieval");
  // Everything that was already unambiguous is untouched.
  assert.equal(out[0], "Prachin");
  assert.equal(out[5], "Naveen");
});

test("a colliding triple falls back for all three", () => {
  const given = ["Prachin", "Madhya", "Madhya", "Madhya", "Aadhunik", "Naveen"];
  const out = distinctEraLabels(given, ENGLISH);
  assert.deepEqual(out.slice(1, 4), ["Early medieval", "High medieval", "Late medieval"]);
});

test("the result is always pairwise distinct, whatever came in", () => {
  const allSame = new Array(ERAS.length).fill("same");
  assert.equal(new Set(distinctEraLabels(allSame, ENGLISH)).size, ERAS.length);
});

// ---- the guarantee, against the real translation file ----------------------

test("no offered language shows two eras under the same label", () => {
  // The reason this exists: Mayura returned one word for "Early medieval",
  // "High medieval" AND "Late medieval" in Bengali, Tamil and Kannada — three
  // identical buttons on the era strip, which is worse than leaving it English.
  for (const lang of TRANSLATED_LANGUAGES) {
    const bundle = UI_TRANSLATIONS[lang] ?? {};
    const translated = ERAS.map((e, i) => bundle[`era.${e.id}` as UiKey] ?? ENGLISH[i]!);
    const shown = distinctEraLabels(translated, ENGLISH);
    assert.equal(new Set(shown).size, ERAS.length, `${lang} renders two eras identically: ${shown.join(" / ")}`);
  }
});
