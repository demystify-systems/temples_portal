/**
 * The languages a person can choose to speak to the atlas in.
 *
 * Until now the language was only ever DETECTED — Saarika returns a
 * `language_code` and the answer follows it. Detection is the right default and
 * stays the default, but it is not sufficient on its own for two reasons:
 *
 *   1. It has to hear you first. A detector needs a second or two of speech to
 *      commit, and on a short question ("Kedarnath?") it commits on very little.
 *      Stating the language up front turns a guess into a given, and Sarvam's
 *      STT accepts it as a hint, so accuracy improves on the very utterances
 *      detection is worst at.
 *   2. It offers no way in. Someone who would rather ask in Tamil has no signal
 *      that they may — the interface is in English, so it reads as an English
 *      product that will not understand them. A visible list of languages is
 *      the invitation; that is most of what it is for.
 *
 * Every label is an ENDONYM — the language's name in its own script and its own
 * words. A Tamil speaker looking for Tamil is looking for தமிழ், not for the
 * English word "Tamil" written in Latin script. Showing the English name to
 * someone who cannot read English is the same failure as answering in the wrong
 * language, made earlier.
 */

import { SPEAKABLE_LANGUAGES } from "./voice.ts";

export type SpokenLanguage = {
  /** Sarvam's tag. Always `xx-IN`. */
  readonly code: string;
  /** The language's name in its own script. What the picker shows. */
  readonly endonym: string;
  /** The English name, for the `lang`-attributed title and for screen readers set to English. */
  readonly english: string;
  /** False when Saarika can hear it but Bulbul cannot speak it back. */
  readonly speakable: boolean;
};

/**
 * Ordered by number of speakers, with English first because it is the language
 * the surrounding interface is written in and therefore the safe default for
 * someone who has not chosen.
 *
 * The list is Saarika's — everything here can be UNDERSTOOD. `speakable` marks
 * the ones Bulbul can also read an answer back in; the rest still work, they
 * just answer in text. That gap is surfaced rather than hidden, because being
 * silently answered in English is worse than being told the reply is text-only.
 */
const LANGUAGES: readonly Omit<SpokenLanguage, "speakable">[] = [
  { code: "en-IN",  endonym: "English",   english: "English" },
  { code: "hi-IN",  endonym: "हिन्दी",      english: "Hindi" },
  { code: "bn-IN",  endonym: "বাংলা",      english: "Bengali" },
  { code: "te-IN",  endonym: "తెలుగు",     english: "Telugu" },
  { code: "mr-IN",  endonym: "मराठी",      english: "Marathi" },
  { code: "ta-IN",  endonym: "தமிழ்",      english: "Tamil" },
  { code: "gu-IN",  endonym: "ગુજરાતી",    english: "Gujarati" },
  { code: "kn-IN",  endonym: "ಕನ್ನಡ",      english: "Kannada" },
  { code: "ml-IN",  endonym: "മലയാളം",    english: "Malayalam" },
  { code: "pa-IN",  endonym: "ਪੰਜਾਬੀ",     english: "Punjabi" },
  { code: "od-IN",  endonym: "ଓଡ଼ିଆ",      english: "Odia" },
  { code: "as-IN",  endonym: "অসমীয়া",    english: "Assamese" },
  { code: "ur-IN",  endonym: "اردو",       english: "Urdu" },
  { code: "sa-IN",  endonym: "संस्कृतम्",    english: "Sanskrit" },
  { code: "ne-IN",  endonym: "नेपाली",      english: "Nepali" },
  { code: "kok-IN", endonym: "कोंकणी",     english: "Konkani" },
  { code: "mai-IN", endonym: "मैथिली",      english: "Maithili" },
  { code: "sd-IN",  endonym: "سنڌي",       english: "Sindhi" },
  { code: "ks-IN",  endonym: "کٲشُر",       english: "Kashmiri" },
  { code: "doi-IN", endonym: "डोगरी",      english: "Dogri" },
  { code: "mni-IN", endonym: "ꯃꯤꯇꯩꯂꯣꯟ",   english: "Manipuri" },
  { code: "brx-IN", endonym: "बर’",        english: "Bodo" },
];

/** `speakable` is derived from voice.ts rather than restated, so the two cannot drift. */
export const SPOKEN_LANGUAGES: readonly SpokenLanguage[] = LANGUAGES.map((l) => ({
  ...l,
  speakable: SPEAKABLE_LANGUAGES.includes(l.code),
}));

/**
 * `null` means "work it out from what you hear", which stays the default.
 *
 * Not a language code: an explicit absence. Detection is genuinely better than
 * a wrong choice — someone who picks Hindi and then asks in English should be
 * understood — so choosing a language HINTS the transcriber rather than
 * constraining it.
 */
export const AUTO_DETECT = null;

export const languageByCode = (code: string | null | undefined): SpokenLanguage | null =>
  SPOKEN_LANGUAGES.find((l) => l.code === code) ?? null;

/** The endonym, or a plain phrase for auto-detect. Used in the picker and the status line. */
export const endonymOf = (code: string | null | undefined): string =>
  languageByCode(code)?.endonym ?? "Detect automatically";

/**
 * A browser locale mapped onto a language we can offer, or null.
 *
 * Used ONLY to preselect the picker, never to decide how to answer. A device
 * locale says where a phone was bought at least as often as it says what its
 * owner speaks, so it is a reasonable opening guess and a poor conclusion.
 */
export function preferredFromLocale(locale: string | null | undefined): string | null {
  const base = (locale ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (!base) return null;
  const alias: Record<string, string> = { or: "od", ori: "od" };
  const wanted = `${alias[base] ?? base}-IN`;
  return SPOKEN_LANGUAGES.some((l) => l.code === wanted) ? wanted : null;
}
