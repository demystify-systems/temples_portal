// Translate the INTERFACE into the languages the atlas offers.
//
//   SARVAM_API_KEY=… node scripts/build-ui-translations.mjs
//   node scripts/build-ui-translations.mjs --check   # fail if any key is missing
//
// Only src/lib/ui-strings.ts is translated: navigation labels, buttons, status
// lines. Our own words, for which nobody is cited.
//
// RECORD PROSE IS NEVER TRANSLATED. Not `significance`, not `story`, not a
// source's title. A machine-translated paragraph rendered under a citation is an
// uncited claim attributed to a source that never made it — and it would look
// exactly like a sourced fact, which is what makes it the worst possible bug in
// this project. The way to read a record in another language is to ask the
// assistant, which answers in the reader's language FROM the cited text.
//
// Translations are generated at BUILD time and committed, not fetched at
// runtime, for three reasons: they are reviewable in a diff by someone who
// actually reads the language; they cost nothing per visitor; and they work
// offline, which a runtime translation service cannot.
//
// Mayura rather than a general model: it is Sarvam's Indic translation model,
// it is the same vendor already used for the assistant, and it needs no new
// dependency.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "lib", "generated", "ui-translations.ts");
const BASE = "https://api.sarvam.ai";

/**
 * The languages the interface is offered in.
 *
 * A deliberate subset of the 22 the ASSISTANT understands. An interface
 * language is a promise that the whole surface is readable, and each one is
 * ~47 strings someone should be able to check. These eight cover the large
 * majority of readers; adding more is a decision to maintain them.
 */
const TARGETS = ["hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN", "gu-IN", "kn-IN", "ml-IN"];

/**
 * Hand corrections, applied over the machine's output.
 *
 * The generated file has told readers since it was written to "correct it in
 * this file AND pin it in the script's OVERRIDES" — and no OVERRIDES existed,
 * so every correction was reverted by the next build. This is that mechanism.
 *
 * Each entry records what the model produced and why it is wrong. Add one only
 * for a string you can justify in the comment; a silent override is just a
 * second machine translation with fewer eyes on it.
 *
 * NOT reviewed by a native speaker. These replace translations that were
 * plainly wrong in meaning with ones that are defensible — several by
 * transliteration, which is what the model itself chose for Bengali and
 * Kannada. A reader of any of these languages should still check them.
 */

/**
 * The six construction eras, written here rather than taken from Mayura.
 *
 * They are qualified forms of three words — EARLY/HIGH/LATE medieval,
 * EARLY modern/modern — and asked for each label in isolation the model returns
 * the base word and drops the qualifier. Seven of the eight languages came back
 * with collisions and three of them rendered THREE eras under one identical
 * label, which on the era strip is three identical buttons.
 *
 * These use the qualifier pairs each language's own historiography uses:
 * पूर्व/उत्तर in Hindi and Marathi, আদি/অন্ত্য in Bengali, முற்கால/பிற்கால in
 * Tamil, ಪೂರ್ವ/ಉತ್ತರ in Kannada, ആദ്യ/അന്ത്യ in Malayalam.
 *
 * Still model-written, not reviewed by a native speaker — but six distinct and
 * defensible labels rather than one word repeated three times. A reader who
 * knows better should correct them here.
 */
const ERA_LABELS = {
  "hi-IN": { "era.ancient": "प्राचीन", "era.earlyMedieval": "पूर्व मध्यकालीन", "era.highMedieval": "उच्च मध्यकालीन", "era.lateMedieval": "उत्तर मध्यकालीन", "era.earlyModern": "आरंभिक आधुनिक", "era.modern": "आधुनिक" },
  "bn-IN": { "era.ancient": "প্রাচীন", "era.earlyMedieval": "আদি মধ্যযুগ", "era.highMedieval": "উচ্চ মধ্যযুগ", "era.lateMedieval": "অন্ত্য মধ্যযুগ", "era.earlyModern": "আদি আধুনিক", "era.modern": "আধুনিক" },
  "ta-IN": { "era.ancient": "பண்டைய", "era.earlyMedieval": "முற்கால இடைக்காலம்", "era.highMedieval": "உயர் இடைக்காலம்", "era.lateMedieval": "பிற்கால இடைக்காலம்", "era.earlyModern": "ஆரம்ப நவீன", "era.modern": "நவீன" },
  "te-IN": { "era.ancient": "ప్రాచీన", "era.earlyMedieval": "పూర్వ మధ్యయుగం", "era.highMedieval": "ఉన్నత మధ్యయుగం", "era.lateMedieval": "ఉత్తర మధ్యయుగం", "era.earlyModern": "ఆది ఆధునిక", "era.modern": "ఆధునిక" },
  "mr-IN": { "era.ancient": "प्राचीन", "era.earlyMedieval": "पूर्व मध्ययुगीन", "era.highMedieval": "उच्च मध्ययुगीन", "era.lateMedieval": "उत्तर मध्ययुगीन", "era.earlyModern": "आरंभिक आधुनिक", "era.modern": "आधुनिक" },
  "gu-IN": { "era.ancient": "પ્રાચીન", "era.earlyMedieval": "પૂર્વ મધ્યયુગ", "era.highMedieval": "ઉચ્ચ મધ્યયુગ", "era.lateMedieval": "ઉત્તર મધ્યયુગ", "era.earlyModern": "આરંભિક આધુનિક", "era.modern": "આધુનિક" },
  "kn-IN": { "era.ancient": "ಪ್ರಾಚೀನ", "era.earlyMedieval": "ಪೂರ್ವ ಮಧ್ಯಯುಗ", "era.highMedieval": "ಉಚ್ಚ ಮಧ್ಯಯುಗ", "era.lateMedieval": "ಉತ್ತರ ಮಧ್ಯಯುಗ", "era.earlyModern": "ಆರಂಭಿಕ ಆಧುನಿಕ", "era.modern": "ಆಧುನಿಕ" },
  "ml-IN": { "era.ancient": "പുരാതന", "era.earlyMedieval": "ആദ്യ മധ്യകാലം", "era.highMedieval": "ഉന്നത മധ്യകാലം", "era.lateMedieval": "അന്ത്യ മധ്യകാലം", "era.earlyModern": "ആദ്യ ആധുനിക", "era.modern": "ആധുനിക" },
};

const OVERRIDES = {
  "hi-IN": {
    // "भू-आलेख" is a LAND RECORD — a revenue document. A gazetteer is a
    // geographical reference work. Transliterated, as bn-IN and kn-IN were.
    "nav.gazetteer": "गजेटियर",
  },
  "ta-IN": {
    // "அட்டவணை" is a table, schedule or index — not a map. Every other
    // language rendered "Atlas map" as its word for map; this is Tamil's.
    "nav.atlas": "வரைபடம்",
    // "கலைக்களஞ்சியம்" is an ENCYCLOPAEDIA. Different reference work.
    "nav.gazetteer": "கெசட்டியர்",
  },
  "gu-IN": {
    // "ભૂસ્તરશાસ્ત્રીય ગ્રંથ" is a GEOLOGICAL text — ભૂસ્તરશાસ્ત્ર is geology,
    // not geography. This atlas is not about rocks.
    "nav.gazetteer": "ગેઝેટિયર",
  },
  "ml-IN": {
    // "ഗസറ്റ്" is a gazette: an official government journal. Close to the word
    // and not the meaning.
    "nav.gazetteer": "ഗസറ്റിയർ",
  },
};

const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 1500;
/** Between calls. Cheaper than being rate-limited and backing off. */
const PACE_MS = 220;

/** Pull the key/value pairs straight out of the source, so the two cannot drift. */
const readStrings = () => {
  const source = readFileSync(path.join(ROOT, "src", "lib", "ui-strings.ts"), "utf8");
  const body = source.slice(source.indexOf("export const UI_STRINGS"), source.indexOf("} as const;"));
  const out = {};
  for (const [, key, value] of body.matchAll(/^\s*"([\w.&]+)":\s*"((?:[^"\\]|\\.)*)",$/gm)) {
    out[key] = value.replace(/\\"/g, '"');
  }
  return out;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One string, with backoff.
 *
 * Mayura rate-limits, and it does so partway through: the first run reached
 * ta-IN — the third of eight languages — and threw, discarding 94 translations
 * that had already been paid for. A 429 is a "wait", not a failure, so it is
 * waited on rather than propagated.
 */
const translate = async (apiKey, text, to, attempt = 0) => {
  const res = await fetch(`${BASE}/translate`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, source_language_code: "en-IN", target_language_code: to }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`translate ${to}: ${res.status} after ${MAX_RETRIES} retries`);
    }
    const wait = BASE_BACKOFF_MS * 2 ** attempt;
    process.stdout.write(`\r    ${res.status} — waiting ${wait}ms  `);
    await sleep(wait);
    return translate(apiKey, text, to, attempt + 1);
  }

  if (!res.ok) throw new Error(`translate ${to}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const json = await res.json();
  const out = (json?.translated_text ?? "").trim();
  if (!out) throw new Error(`translate ${to}: empty result for ${JSON.stringify(text)}`);
  return out;
};

const render = (strings, translations) => `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Written by scripts/build-ui-translations.mjs from src/lib/ui-strings.ts,
// using Sarvam's Mayura translation model.
//
// INTERFACE COPY ONLY. No record prose is translated anywhere in this project:
// a machine-translated \`significance\` under a citation would be an uncited
// claim attributed to a source that never made it. See ui-strings.ts.
//
// Reviewable on purpose. If you read one of these languages and a string is
// wrong, correct it in this file AND pin it in the script's OVERRIDES, or the
// next build will put the machine's version back.

import type { UiKey } from "../ui-strings.ts";

export const UI_TRANSLATIONS: Readonly<Record<string, Readonly<Partial<Record<UiKey, string>>>>> = ${
  JSON.stringify(translations, null, 2)
};

/** Languages with a complete interface. English is the source and always complete. */
export const TRANSLATED_LANGUAGES: readonly string[] = ${
  JSON.stringify(["en-IN", ...Object.keys(translations)])
};

/** How many strings the interface has, so a partial translation is detectable. */
export const UI_STRING_COUNT = ${Object.keys(strings).length};
`;

const main = async () => {
  const strings = readStrings();
  const keys = Object.keys(strings);
  if (keys.length === 0) throw new Error("no strings parsed out of ui-strings.ts");

  if (process.argv.includes("--check")) {
    if (!existsSync(OUT)) { console.error("build-ui-translations: generated file missing"); process.exit(1); }
    const onDisk = readFileSync(OUT, "utf8");
    const declared = Number(/UI_STRING_COUNT = (\d+)/.exec(onDisk)?.[1] ?? 0);
    if (declared !== keys.length) {
      console.error(
        `build-ui-translations: ui-strings.ts has ${keys.length} strings but the generated file was built from ${declared}.\n` +
        "  Run: SARVAM_API_KEY=… node scripts/build-ui-translations.mjs",
      );
      process.exit(1);
    }
    console.log(`build-ui-translations: up to date (${keys.length} strings)`);
    return;
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) { console.error("build-ui-translations: SARVAM_API_KEY is not set"); process.exit(1); }

  // Anything a previous run completed, so this is resumable and idempotent.
  const existing = existsSync(OUT)
    ? (() => {
        const text = readFileSync(OUT, "utf8");
        const at = text.indexOf("UI_TRANSLATIONS: Readonly<Record<string, Readonly<Partial<Record<UiKey, string>>>>> = ");
        if (at < 0) return {};
        const json = text.slice(text.indexOf("{", at), text.lastIndexOf("};\n\n/** Languages"));
        try { return JSON.parse(json); } catch { return {}; }
      })()
    : {};

  /**
   * Seeded from what is already on disk, NOT empty.
   *
   * The file is rewritten after every language so an interrupted run keeps what
   * it has paid for. Starting this empty defeated that: a run that resumed,
   * replayed two cached languages and was then interrupted wrote a file
   * containing only those two — discarding five it had just read — and the next
   * run resumed from the truncated file. Losing work is bad; losing it while
   * appearing to resume is worse.
   */
  const translations = { ...existing };
  for (const target of TARGETS) {
    /**
     * Resume, but only for keys that still exist.
     *
     * Carrying the previous bundle over wholesale also carried RETIRED keys.
     * When `assistant.open` became `assistant.title` — a rename done precisely
     * so a stale translation could not survive a copy change — the old key came
     * straight back in, and tsc rejected the generated file for naming a key
     * that is no longer part of UiKey. Caught by the type system, which is the
     * argument for the generated file being typed against the source at all.
     */
    const previous = existing[target] ?? {};
    const bundle = Object.fromEntries(keys.filter((k) => previous[k]).map((k) => [k, previous[k]]));
    for (const key of keys) {
      if (bundle[key]) continue;
      bundle[key] = await translate(apiKey, strings[key], target);
      await sleep(PACE_MS);
    }
    // Hand corrections win over the model, every build.
    translations[target] = { ...bundle, ...(ERA_LABELS[target] ?? {}), ...(OVERRIDES[target] ?? {}) };
    // Written after EVERY language, not once at the end. A run that dies on the
    // seventh language must not throw away the six that succeeded.
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, render(strings, translations));
    console.log(`\r  ${target}  ${Object.keys(bundle).length} strings          `);
  }

  console.log(`build-ui-translations: ${keys.length} strings x ${TARGETS.length} languages -> ${path.relative(ROOT, OUT)}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error("build-ui-translations:", error.message); process.exit(1); });
}
