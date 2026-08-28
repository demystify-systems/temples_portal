/**
 * Preferences that survive a reload.
 *
 * Everything here is a CHOICE THE READER MADE — the interface language, whether
 * the era key is open, which map layers are on. Losing those on every visit is
 * the difference between a site and an app: someone who has told us twice that
 * they read Tamil should not be asked a third time.
 *
 * Deliberately NOT here: anything about the corpus, and anything identifying.
 * No history, no queries, no record ids, no analytics. This is a handful of UI
 * flags in `localStorage` on the reader's own device; nothing in it is sent
 * anywhere, and the atlas works identically with the whole thing cleared.
 *
 * Every read and write is wrapped. `localStorage` THROWS rather than returning
 * null in a private window, in an embedded webview with site data blocked, and
 * on a browser with cookies disabled — and an uncaught throw here would take
 * down the whole client component for the sake of remembering a checkbox.
 */

const PREFIX = "tirtha.";

/** Read a stored value, or the fallback. Never throws. */
export function readPreference<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Blocked storage, or a value written by an older version whose shape has
    // since changed. The fallback is always safe; a crash is not.
    return fallback;
  }
}

/** Store a value. Never throws — a preference that cannot be saved is not an error. */
export function writePreference(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded, or storage blocked. The setting still applies for this
    // session; it just will not be there next time, which is the pre-existing
    // behaviour and not worth telling anyone about.
  }
}

export const PREF_KEYS = {
  /** Interface language, as a Sarvam `xx-IN` tag. */
  uiLanguage: "ui.lang",
  /** The language chosen for SPEAKING, which is a different choice. */
  voiceLanguage: "voice.lang",
  /** Whether the map's era key is expanded. */
  legendOpen: "map.legend",
} as const;
