import test from "node:test";
import assert from "node:assert/strict";
import { SPOKEN_LANGUAGES, endonymOf, languageByCode, preferredFromLocale } from "./languages.ts";
import { SPEAKABLE_LANGUAGES, normaliseLanguageCode, isSpeakable } from "./voice.ts";

test("every offered language carries an endonym in its own script", () => {
  // The whole point: a Tamil speaker looks for தமிழ், not for "Tamil".
  for (const lang of SPOKEN_LANGUAGES) {
    assert.ok(lang.endonym.length > 0, `${lang.code} has no endonym`);
    if (lang.code === "en-IN") continue;
    assert.notEqual(
      lang.endonym, lang.english,
      `${lang.code} shows its ENGLISH name (${lang.english}) — a reader who cannot read English cannot find it`,
    );
  }
});

test("every code is one Sarvam actually accepts", () => {
  for (const lang of SPOKEN_LANGUAGES) {
    assert.equal(normaliseLanguageCode(lang.code), lang.code, `${lang.code} is not in Sarvam's xx-IN form`);
  }
});

test("speakable is derived from voice.ts, never restated", () => {
  // Two hand-maintained lists of the same fact drift, and the drift is silent:
  // a language marked speakable that Bulbul refuses answers with an error the
  // user cannot act on.
  for (const lang of SPOKEN_LANGUAGES) {
    assert.equal(lang.speakable, isSpeakable(lang.code), `${lang.code} disagrees with isSpeakable`);
  }
});

test("every language Bulbul speaks is offered", () => {
  for (const code of SPEAKABLE_LANGUAGES) {
    assert.ok(
      SPOKEN_LANGUAGES.some((l) => l.code === code),
      `${code} can be spoken aloud but is not offered in the picker`,
    );
  }
});

test("languages Saarika hears but Bulbul cannot speak are offered and marked", () => {
  // They still work — the answer arrives as text. Hiding them would refuse a
  // question we can actually understand.
  const listenOnly = SPOKEN_LANGUAGES.filter((l) => !l.speakable);
  assert.ok(listenOnly.length > 0, "Sanskrit, Urdu and Kashmiri are heard but not spoken");
  assert.ok(listenOnly.some((l) => l.code === "sa-IN"));
});

test("English is first, because the interface around it is in English", () => {
  assert.equal(SPOKEN_LANGUAGES[0].code, "en-IN");
});

test("codes are unique", () => {
  const codes = SPOKEN_LANGUAGES.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("an unset language reads as auto-detect, not as a language", () => {
  assert.equal(endonymOf(null), "Detect automatically");
  assert.equal(endonymOf(undefined), "Detect automatically");
  assert.equal(endonymOf("zz-IN"), "Detect automatically");
  assert.equal(languageByCode(null), null);
});

test("a browser locale preselects the picker, and only that", () => {
  assert.equal(preferredFromLocale("ta"), "ta-IN");
  assert.equal(preferredFromLocale("ta-IN"), "ta-IN");
  assert.equal(preferredFromLocale("hi_IN"), "hi-IN");
  assert.equal(preferredFromLocale("en-GB"), "en-IN", "region is irrelevant; Sarvam tags are all -IN");
  // Odia is `or` in ISO 639-1 and `od` to Sarvam.
  assert.equal(preferredFromLocale("or"), "od-IN");
  // A language we cannot offer must not be silently swapped for one we can.
  assert.equal(preferredFromLocale("fr"), null);
  assert.equal(preferredFromLocale("de-DE"), null);
  assert.equal(preferredFromLocale(""), null);
  assert.equal(preferredFromLocale(null), null);
});
