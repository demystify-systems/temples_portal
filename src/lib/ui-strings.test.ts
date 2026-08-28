import test from "node:test";
import assert from "node:assert/strict";
import { UI_STRINGS, UI_KEYS } from "./ui-strings.ts";
import { UI_TRANSLATIONS, TRANSLATED_LANGUAGES, UI_STRING_COUNT } from "./generated/ui-translations.ts";
import { SPOKEN_LANGUAGES } from "./ai/languages.ts";

test("the generated file was built from the current string set", () => {
  // If someone adds a string and does not re-run the translator, this is the
  // test that says so — rather than eight interfaces quietly falling back to
  // English for that one label.
  assert.equal(
    UI_STRING_COUNT, UI_KEYS.length,
    `ui-strings.ts has ${UI_KEYS.length} strings; translations were built from ${UI_STRING_COUNT}. ` +
    "Run: SARVAM_API_KEY=… node scripts/build-ui-translations.mjs",
  );
});

test("every offered interface language translates every key", () => {
  for (const lang of TRANSLATED_LANGUAGES) {
    if (lang === "en-IN") continue; // the source
    const bundle = UI_TRANSLATIONS[lang];
    assert.ok(bundle, `${lang} is offered but has no translations`);
    const missing = UI_KEYS.filter((k) => !bundle[k]);
    assert.deepEqual(missing, [], `${lang} is missing: ${missing.join(", ")}`);
  }
});

test("no translation is left as the English source", () => {
  // A translator that echoes its input is a failure that looks like success.
  // Short shared tokens are exempt: several Indic languages legitimately keep
  // "Atlas" or a numeral, and a proper noun is not a mistranslation.
  for (const lang of TRANSLATED_LANGUAGES) {
    if (lang === "en-IN") continue;
    const bundle = UI_TRANSLATIONS[lang] ?? {};
    const echoed = UI_KEYS.filter((k) => {
      const source = UI_STRINGS[k];
      return source.length > 12 && bundle[k] === source;
    });
    assert.deepEqual(echoed, [], `${lang} echoed the English for: ${echoed.join(", ")}`);
  }
});

test("every interface language is one the picker can name in its own script", () => {
  for (const lang of TRANSLATED_LANGUAGES) {
    const known = SPOKEN_LANGUAGES.find((l) => l.code === lang);
    assert.ok(known, `${lang} has translations but no endonym — the picker cannot label it`);
  }
});

test("interface languages are a subset of the languages the assistant understands", () => {
  // Offering an interface in a language the assistant cannot answer in would
  // invite a question it must then refuse for a reason the reader cannot see.
  for (const lang of TRANSLATED_LANGUAGES) {
    assert.ok(
      SPOKEN_LANGUAGES.some((l) => l.code === lang),
      `${lang} is offered as an interface language but the assistant does not understand it`,
    );
  }
});

test("keys are stable identifiers, not English text", () => {
  // A key that IS the English means changing the copy silently invalidates
  // every translation of it while still matching.
  for (const key of UI_KEYS) {
    assert.match(key, /^[a-z]+(\.[a-zA-Z&]+)+$/, `${key} is not a dotted identifier`);
    assert.notEqual(key, UI_STRINGS[key]);
  }
});

test("the language note states the limit of what is translated", () => {
  // The one string that must never be dropped: it is what stops a reader
  // assuming the temple records were translated too.
  const note = UI_STRINGS["lang.note"];
  assert.match(note, /interface/i);
  assert.match(note, /sources/i);
});
