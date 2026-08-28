/**
 * Decorative icons for the index pages: countries, traditions, circuits, dynasties.
 *
 * Pure data and pure functions — no React, no JSX, no corpus import — for the
 * same reason as `site-utils.ts`: the whole module is a function of its
 * arguments, so `node --test` can exercise it without pulling data/sites.json
 * (3.3 MB) into the runner. Pages render the `d` strings below inside a
 * one-line `<svg>`; nothing here emits markup.
 *
 * TWO RULES GOVERN EVERYTHING IN THIS FILE.
 *
 * 1. EVERY ICON IS DECORATIVE, NEVER LOAD-BEARING. Each one is rendered
 *    `aria-hidden` beside a real text label, and the label is what carries the
 *    meaning. Emoji flags in particular do not render on many Windows
 *    configurations (they degrade to a bare "IN"), and a screen reader has
 *    nothing useful to say about a filled path — so the country NAME, the
 *    tradition NAME and the member COUNT are always present as text. Deleting
 *    every glyph on these pages must lose decoration and no information.
 *
 * 2. AN ICON MAY NOT ASSERT WHAT THE SOURCES DO NOT (constitution rule 2).
 *    Circuits and dynasties have no canonical symbol, so they get typographic
 *    and structural devices only — a member count, the era colour band, a route
 *    glyph whose meaning is "more than one member", all read off the corpus.
 *    Inventing a crest for the Cholas would be inventing a field.
 *
 * DELIBERATELY ABSENT: the swastika. It is the traditional Jain symbol and
 * entirely legitimate in Indic usage, but this atlas is public and
 * international, where the glyph reads as the Nazi appropriation to most
 * viewers on sight. `icons.test.ts` asserts that no codepoint in this file is
 * U+0FD5–U+0FD8, U+5350 or U+534D, so it cannot come back by accident.
 */

import { ERAS } from "./site-utils.ts";

// ---------------------------------------------------------------------------
// countries — emoji regional-indicator flags
// ---------------------------------------------------------------------------

/**
 * ISO 3166-1 alpha-2 for every country string the corpus uses, keyed on that
 * string verbatim.
 *
 * KEYED ON THE FIELD, NOT ON GEOGRAPHY. Per constitution rule 1, sites in
 * Pakistan-occupied Jammu & Kashmir carry `country: "India"`, and so they show
 * the Indian flag — which is exactly right and must not be "corrected" here.
 * This table maps a stored value to a glyph; it does not adjudicate territory,
 * and no lookup in it is allowed to disagree with the record it came from.
 *
 * Add a row only when the corpus actually gains that country string. An unknown
 * value falls back rather than guessing.
 */
export const COUNTRY_CODES: Readonly<Record<string, string>> = Object.freeze({
  Afghanistan: "AF",
  Bangladesh: "BD",
  Bhutan: "BT",
  Cambodia: "KH",
  India: "IN",
  Indonesia: "ID",
  Laos: "LA",
  Malaysia: "MY",
  Myanmar: "MM",
  Nepal: "NP",
  Pakistan: "PK",
  Singapore: "SG",
  "Sri Lanka": "LK",
  Thailand: "TH",
  Vietnam: "VN",
});

/**
 * Shown for a country string with no code yet: the globe centred on Asia.
 *
 * Neutral on purpose. It claims nothing about the place, and it is a long-lived
 * emoji present in every current font — unlike a rarer glyph, which would draw
 * a tofu box and look like a bug.
 */
export const FLAG_FALLBACK = "\u{1F30F}";

/** Regional indicator symbol letter A (U+1F1E6) — the base of every flag emoji. */
const REGIONAL_INDICATOR_A = 0x1f1e6;
const ASCII_A = "A".charCodeAt(0);
const ALPHA2 = /^[A-Z]{2}$/;

/**
 * The flag emoji for a country string: "India" -> 🇮🇳.
 *
 * A flag emoji is its two-letter code written in regional indicator symbols;
 * the font ligates the pair into a flag, or — on many Windows builds — draws
 * the two letters instead. Both outcomes are fine, because the country name is
 * always beside it.
 *
 * Total: unknown, empty and non-string input all return `FLAG_FALLBACK` rather
 * than throwing or returning "", so a caller can always render the result.
 */
export const flagOf = (country: string | undefined | null): string => {
  if (typeof country !== "string") return FLAG_FALLBACK;
  const code = COUNTRY_CODES[country.trim()];
  if (!code || !ALPHA2.test(code)) return FLAG_FALLBACK;
  return String.fromCodePoint(
    ...[...code].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - ASCII_A),
  );
};

// ---------------------------------------------------------------------------
// traditions — the map's own shape language
// ---------------------------------------------------------------------------

/**
 * Every glyph in this file is drawn in an 11×11 box, matching the map legend's
 * `.shape` rule in globals.css, so an icon in a list sits at exactly the size
 * and weight it does on the atlas.
 */
export const ICON_VIEWBOX = "0 0 11 11";

export type Glyph = {
  /** What the shape is called in the map legend; "bar" is the unknown fallback. */
  readonly shape: "circle" | "square" | "diamond" | "triangle" | "bar";
  /** A single fill path — pages render it as `<path d={...} />`, no strokes. */
  readonly d: string;
};

/** Two decimals is well under a pixel at 11px, and keeps 3 - 2.1 from printing as 0.8999999999999999. */
const round = (value: number): string => String(Number(value.toFixed(2)));

/** A filled disc as one path, so every glyph here is a single `<path>` element. */
const disc = (cx: number, cy: number, r: number): string =>
  `M${round(cx - r)} ${round(cy)}a${round(r)} ${round(r)} 0 1 0 ${round(r * 2)} 0a${round(r)} ${round(r)} 0 1 0 ${round(-r * 2)} 0Z`;

/**
 * Tradition -> shape, reusing the atlas's existing vocabulary exactly: circle
 * Hindu, square Buddhist, diamond Jain, triangle Sikh.
 *
 * These are the same four geometries `AtlasClient.tsx` draws for its marks and
 * its "Tradition (shape)" legend, at the same coordinates. That is the whole
 * point of choosing shapes over symbols: a reader who has learned the map's
 * legend already knows what a diamond means, and one legend now serves both
 * surfaces. It also sidesteps the symbol problem — no religious mark is picked
 * for one tradition and withheld from another, and no swastika appears.
 */
export const TRADITION_ICONS: Readonly<Record<string, Glyph>> = Object.freeze({
  Hindu: Object.freeze({ shape: "circle", d: disc(5.5, 5.5, 4.6) } as const),
  Buddhist: Object.freeze({ shape: "square", d: "M1.4 1.4H9.6V9.6H1.4Z" } as const),
  Jain: Object.freeze({ shape: "diamond", d: "M5.5 0L11 5.5L5.5 11L0 5.5Z" } as const),
  Sikh: Object.freeze({ shape: "triangle", d: "M5.5 0.4L10.8 10.2H0.2Z" } as const),
});

/**
 * Shown for a tradition the map has no shape for: a neutral bar.
 *
 * Deliberately NOT the circle. Falling back to a legend shape would silently
 * label an unknown tradition "Hindu" on sight; a bar belongs to no tradition
 * and reads as "not one of the four".
 */
export const TRADITION_FALLBACK: Glyph = Object.freeze({ shape: "bar", d: "M1 4.6H10V6.4H1Z" } as const);

/** The glyph for a tradition string; unknown, empty and non-string all fall back. */
export const traditionIcon = (tradition: string | undefined | null): Glyph =>
  (typeof tradition === "string" ? TRADITION_ICONS[tradition.trim()] : undefined) ?? TRADITION_FALLBACK;

// ---------------------------------------------------------------------------
// circuits — a route glyph, which says only "how many members"
// ---------------------------------------------------------------------------

/** Wider than the square glyphs: a route is a line, not a mark. */
export const ROUTE_VIEWBOX = "0 0 22 11";

/**
 * A circuit's glyph, chosen by member count and by nothing else.
 *
 * The corpus records circuit MEMBERSHIP (`circuits: string[]`) and no order —
 * there is no field saying a Jyotirlinga yatra runs Somnath-first, so the glyph
 * must not imply one. Three evenly spaced nodes on a line say "a network of
 * several places" and stop there; a single node says "one member so far". The
 * count itself is always printed beside it.
 */
export const ROUTE_ICONS: Readonly<Record<"network" | "single", Glyph>> = Object.freeze({
  network: Object.freeze({
    shape: "bar",
    d: `M3 4.95H19V6.05H3Z${disc(3, 5.5, 2.1)}${disc(11, 5.5, 2.1)}${disc(19, 5.5, 2.1)}`,
  } as const),
  single: Object.freeze({ shape: "circle", d: disc(11, 5.5, 2.4) } as const),
});

/**
 * Total over every integer: a negative, fractional or non-finite count is not a
 * network, so it draws the single node rather than throwing.
 */
export const routeIcon = (members: number): Glyph =>
  Number.isFinite(members) && members > 1 ? ROUTE_ICONS.network : ROUTE_ICONS.single;

// ---------------------------------------------------------------------------
// dynasties — the era colour band
// ---------------------------------------------------------------------------

/**
 * Neutral band colour for a year outside the era table (`eraIndex` returns -1
 * past the final boundary). Muted, so it reads as "no era" and never as a sixth
 * era colour.
 */
export const ERA_VAR_FALLBACK = "var(--mut)";

/**
 * The CSS custom property for an era index: 0 -> `var(--e1)`.
 *
 * The palette is colour-blind-validated in both themes and may only change with
 * a re-validated replacement (constitution rule 7) — which is why this returns
 * a token reference and never a literal colour. `ERAS.length` bounds it, so
 * adding a seventh era to `site-utils.ts` without adding `--e7` to globals.css
 * yields the neutral, not a reference to a property that does not exist.
 *
 * The band is decorative: every card that carries one also prints its century
 * span as text.
 */
export const eraVar = (index: number): string =>
  Number.isInteger(index) && index >= 0 && index < ERAS.length ? `var(--e${index + 1})` : ERA_VAR_FALLBACK;
