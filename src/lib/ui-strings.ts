/**
 * The interface's own words, in English, as the source for every translation.
 *
 * WHAT IS TRANSLATED, AND WHAT IS NOT
 * -----------------------------------
 * Only this file. These are OUR words — navigation labels, buttons, section
 * headings, status lines — and translating them is exactly as safe as writing
 * them, because nobody is cited for them.
 *
 * Record prose is NEVER machine-translated. Not `significance`, not `story`,
 * not `access`, not a source's title. A machine-translated `significance`
 * paragraph rendered under a citation is an uncited claim attributed to a source
 * that never made it, which is the single failure CLAUDE.md rule 2 exists to
 * prevent — and it would be invisible, because it would look exactly like a
 * sourced fact.
 *
 * This is also why the Google Website Translator widget is not used. It still
 * serves (HTTP 200 on translate_a/element.js as of 2026-08-28) but Google's own
 * product page 404s, so it is deprecated and unsupported — and more to the
 * point it translates the WHOLE PAGE indiscriminately, including every cited
 * paragraph, with no way to exempt them. It would also be a third-party script
 * with access to the full DOM, on a site whose CSP is pending.
 *
 * The right way to get Indic-language CONTENT out of this atlas already exists:
 * ask the assistant, which answers in the reader's language FROM the cited
 * records rather than by translating the page around them.
 *
 * Keys are dotted and stable. A key is never reused for different words —
 * changing the English means a new key, so a stale translation cannot quietly
 * mistranslate a changed string.
 */

export const UI_STRINGS = {
  "nav.heading": "Navigate",
  "nav.close": "Close",
  "nav.atlas": "Atlas map",
  "nav.atlas.note": "Interactive time-map of every site",
  "nav.gazetteer": "Gazetteer",
  "nav.gazetteer.note": "All sites, by country",
  "nav.circuits": "Circuits",
  "nav.circuits.note": "Pilgrimage networks",
  "nav.dynasties": "Dynasties",
  "nav.dynasties.note": "Ruling houses and eras",
  "nav.deities": "Deities",
  "nav.deities.note": "Who the temples are for",
  "nav.patrons": "Patrons",
  "nav.patrons.note": "Who funded these temples",
  "nav.about": "About & sources",
  "nav.about.note": "Method, boundaries, licences",
  "nav.index": "Index",
  "nav.index.note": "Site list beside the map",

  "stats.sites": "sites",
  "stats.countries": "countries",
  "stats.traditions": "traditions",
  "stats.centuries": "centuries",
  "stats.shown": "shown",

  "filter.search": "Search temples, deities, places…",
  "filter.filters": "Filters",
  "filter.reset": "reset",
  "filter.allCountries": "All countries",
  "filter.allTraditions": "All traditions",
  "filter.allDynasties": "All dynasties",
  "filter.allCircuits": "All circuits",

  "timeline.period": "Period",
  "timeline.showAll": "show all eras",
  "timeline.play": "Play the timeline sweep",
  "timeline.pause": "Pause the timeline sweep",

  "map.key": "Key",
  "map.showKey": "Show the era key",
  "map.hideKey": "Hide the era key",

  /**
   * Renamed from `assistant.open` when the words changed from "Ask the Atlas".
   *
   * A NEW KEY, not an edited value — which is this file's own rule and exactly
   * why it has one. The translator skips keys it already has, so editing the
   * English in place would have left eight languages confidently rendering the
   * previous name for ever, with nothing to detect it.
   */
  "assistant.title": "Talk to Tirtha Atlas",
  "assistant.scope": "Answers only from cited records",
  "assistant.type": "Type",
  "assistant.speak": "Speak",
  "assistant.speakIn": "Speak in",
  "assistant.detect": "Detect automatically",
  "assistant.listening": "Listening",
  "assistant.thinking": "Looking through the cited records",

  "lang.label": "Language",
  /**
   * Shown beside the language picker. It is the honest limit of this feature and
   * it is deliberately part of the translated set, so it appears in the reader's
   * own language rather than in the one they just switched away from.
   */
  "lang.note": "This changes the interface. Temple records stay in the language of their sources — ask the assistant to hear them in yours.",
} as const;

export type UiKey = keyof typeof UI_STRINGS;

/** Every key, for the build-time translator and for the completeness test. */
export const UI_KEYS = Object.keys(UI_STRINGS) as readonly UiKey[];
