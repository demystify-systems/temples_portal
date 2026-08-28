"use client";

/**
 * The interface's language, chosen by the reader and remembered.
 *
 * WHAT THIS DOES AND DOES NOT CHANGE
 * ----------------------------------
 * It changes the CHROME: navigation, buttons, status lines, section headings.
 * Our own words, translated at build time from src/lib/ui-strings.ts.
 *
 * It does NOT change record prose, and that is the important half. A temple's
 * `significance` stays in the language of the sources it was written from,
 * because a machine-translated paragraph under a citation is an uncited claim
 * attributed to someone who never made it — indistinguishable, on the page,
 * from a sourced fact. The way to read a record in another language is to ask
 * the assistant, which answers in the reader's language FROM the cited text
 * rather than by translating the page around it.
 *
 * A missing translation falls back to English per KEY, not per language, so a
 * newly added string shows in English inside an otherwise translated interface
 * instead of blanking or crashing it.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { UI_STRINGS, type UiKey } from "@/lib/ui-strings";
import { UI_TRANSLATIONS, TRANSLATED_LANGUAGES } from "@/lib/generated/ui-translations";
import { SPOKEN_LANGUAGES } from "@/lib/ai/languages";
import { readPreference, writePreference, PREF_KEYS } from "@/lib/preference";

export type Translate = (key: UiKey) => string;

type UiLanguage = {
  readonly lang: string;
  readonly t: Translate;
  readonly setLang: (code: string) => void;
  /** Only the languages with a complete interface — not all 22 the assistant hears. */
  readonly available: readonly { code: string; endonym: string; english: string }[];
};

const DEFAULT_LANG = "en-IN";

const UiLanguageContext = createContext<UiLanguage | null>(null);

/** Interface languages, with their endonyms, in the order languages.ts lists them. */
const AVAILABLE = SPOKEN_LANGUAGES
  .filter((l) => TRANSLATED_LANGUAGES.includes(l.code))
  .map((l) => ({ code: l.code, endonym: l.endonym, english: l.english }));

export function UiLanguageProvider({ children }: { readonly children: React.ReactNode }) {
  /**
   * Always English on the first render.
   *
   * The server has no localStorage, so rendering the stored language
   * immediately would mean the server and the client disagree on every label —
   * a hydration mismatch across the whole interface. The stored choice is
   * applied in an effect, one frame later.
   */
  const [lang, setLangState] = useState(DEFAULT_LANG);

  useEffect(() => {
    const stored = readPreference<string | null>(PREF_KEYS.uiLanguage, null);
    if (stored && TRANSLATED_LANGUAGES.includes(stored)) setLangState(stored);
  }, []);

  useEffect(() => {
    // Keep the document's own language honest: it drives screen-reader voice
    // selection and the browser's own translate prompt.
    document.documentElement.lang = lang.split("-")[0] ?? "en";
  }, [lang]);

  const setLang = useCallback((code: string) => {
    const next = TRANSLATED_LANGUAGES.includes(code) ? code : DEFAULT_LANG;
    setLangState(next);
    writePreference(PREF_KEYS.uiLanguage, next);
  }, []);

  const value = useMemo<UiLanguage>(() => ({
    lang,
    setLang,
    available: AVAILABLE,
    // Per-KEY fallback: a string added since the last translation run shows in
    // English rather than blanking the interface around it.
    t: (key: UiKey) => UI_TRANSLATIONS[lang]?.[key] ?? UI_STRINGS[key],
  }), [lang, setLang]);

  return <UiLanguageContext.Provider value={value}>{children}</UiLanguageContext.Provider>;
}

/**
 * Usable outside the provider, deliberately.
 *
 * Returning English rather than throwing means a component can be rendered in a
 * test, or in a subtree that has not been wrapped yet, without the interface
 * language being a hard dependency of every single one.
 */
export function useUiLanguage(): UiLanguage {
  return useContext(UiLanguageContext) ?? {
    lang: DEFAULT_LANG,
    setLang: () => {},
    available: AVAILABLE,
    t: (key: UiKey) => UI_STRINGS[key],
  };
}

/** Shorthand for the common case: just the translator. */
export const useT = (): Translate => useUiLanguage().t;
