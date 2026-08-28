import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERAS } from "./site-utils.ts";
import {
  COUNTRY_CODES, ERA_VAR_FALLBACK, FLAG_FALLBACK, ICON_VIEWBOX, ROUTE_ICONS, ROUTE_VIEWBOX,
  TRADITION_FALLBACK, TRADITION_ICONS, eraVar, flagOf, routeIcon, traditionIcon, type Glyph,
} from "./icons.ts";

/** The `d` of a tradition's glyph — the thing a page actually renders. */
const traditionIconOf = (tradition: string | undefined | null): string => traditionIcon(tradition).d;

/**
 * The corpus is read as text rather than imported — a JSON import needs an
 * import attribute tsc will not emit — exactly as search-index.test.ts does.
 * These icons are only trustworthy if they still answer to what the corpus
 * actually stores, so the country test runs against the real country strings
 * and not against a list copied out of them.
 */
type Corpus = readonly Record<string, unknown>[];

const CORPUS: Corpus = JSON.parse(
  readFileSync(new URL("../../data/sites.json", import.meta.url), "utf8"),
);

const distinct = (field: string): readonly string[] =>
  [...new Set(CORPUS.map((r) => r[field]).filter((v): v is string => typeof v === "string"))].sort();

const CORPUS_COUNTRIES = distinct("country");
const CORPUS_TRADITIONS = distinct("tradition");

/** Regional indicator symbols A–Z, the only codepoints a flag emoji is made of. */
const RI_FIRST = 0x1f1e6;
const RI_LAST = 0x1f1ff;

/** Unassigned/private-use ranges a font draws as a tofu box, plus the literal box glyphs. */
const isTofuRisk = (cp: number): boolean =>
  (cp >= 0xe000 && cp <= 0xf8ff) || // private use area
  (cp >= 0xfff0 && cp <= 0xffff) || // specials, incl. U+FFFD replacement char
  cp === 0x25a1 || cp === 0x25a0;   // WHITE / BLACK SQUARE, the usual stand-ins

// ---------------------------------------------------------------------------
// countries
// ---------------------------------------------------------------------------

test("every country in the corpus has an ISO code", () => {
  const missing = CORPUS_COUNTRIES.filter((c) => !COUNTRY_CODES[c]);
  assert.deepEqual(missing, [], `no ISO 3166-1 alpha-2 for: ${missing.join(", ")}`);
  // And the table holds nothing the corpus does not use, so it cannot rot
  // quietly into a world atlas.
  const unused = Object.keys(COUNTRY_CODES).filter((c) => !CORPUS_COUNTRIES.includes(c));
  assert.deepEqual(unused, [], `COUNTRY_CODES lists countries no record uses: ${unused.join(", ")}`);
});

test("every country in the corpus resolves to a real two-letter flag", () => {
  for (const country of CORPUS_COUNTRIES) {
    const flag = flagOf(country);
    assert.notEqual(flag, "", `${country} must never render as an empty string`);
    assert.notEqual(flag, FLAG_FALLBACK, `${country} is in the table, so it must not fall back`);
    const points = [...flag].map((ch) => ch.codePointAt(0)!);
    assert.equal(points.length, 2, `${country} -> ${flag} must be exactly two regional indicators`);
    for (const cp of points) {
      assert.ok(cp >= RI_FIRST && cp <= RI_LAST, `${country} -> U+${cp.toString(16)} is not a regional indicator`);
      assert.ok(!isTofuRisk(cp), `${country} -> U+${cp.toString(16)} risks a tofu box`);
    }
  }
});

test("Pakistan-occupied J&K sites keep the Indian flag (constitution rule 1)", () => {
  // The lookup is keyed on the stored `country` field and adjudicates nothing.
  // Records in PoJK carry country: "India", so they must show 🇮🇳 — and the
  // separate country string "Pakistan" must still resolve to its own flag.
  assert.equal(flagOf("India"), "\u{1F1EE}\u{1F1F3}");
  assert.equal(flagOf("Pakistan"), "\u{1F1F5}\u{1F1F0}");
  assert.notEqual(flagOf("India"), flagOf("Pakistan"));
});

test("an unknown country falls back cleanly instead of throwing", () => {
  for (const input of ["Atlantis", "", "   ", "india", "IN", "🇮🇳"]) {
    const flag = flagOf(input);
    assert.equal(flag, FLAG_FALLBACK, `${JSON.stringify(input)} must fall back`);
  }
  assert.equal(flagOf(undefined), FLAG_FALLBACK);
  assert.equal(flagOf(null), FLAG_FALLBACK);
  assert.equal(flagOf(42 as unknown as string), FLAG_FALLBACK, "a non-string must not throw");
});

test("the flag fallback is itself renderable — not empty, not tofu", () => {
  assert.notEqual(FLAG_FALLBACK, "");
  for (const ch of FLAG_FALLBACK) {
    assert.ok(!isTofuRisk(ch.codePointAt(0)!), "the fallback must not risk a tofu box");
  }
});

// ---------------------------------------------------------------------------
// traditions
// ---------------------------------------------------------------------------

test("the tradition map covers every tradition in the corpus", () => {
  assert.deepEqual(CORPUS_TRADITIONS, ["Buddhist", "Hindu", "Jain", "Sikh"]);
  for (const tradition of CORPUS_TRADITIONS) {
    assert.ok(TRADITION_ICONS[tradition], `no icon for ${tradition}`);
    assert.notEqual(traditionIconOf(tradition), TRADITION_FALLBACK.d, `${tradition} must not fall back`);
  }
});

test("the tradition shapes are the map's own, one per tradition", () => {
  // Same vocabulary as AtlasClient's TRADS legend: shape keeps meaning tradition
  // on both surfaces, so the legend transfers.
  assert.equal(TRADITION_ICONS.Hindu.shape, "circle");
  assert.equal(TRADITION_ICONS.Buddhist.shape, "square");
  assert.equal(TRADITION_ICONS.Jain.shape, "diamond");
  assert.equal(TRADITION_ICONS.Sikh.shape, "triangle");
  const shapes = Object.values(TRADITION_ICONS).map((g) => g.shape);
  assert.equal(new Set(shapes).size, shapes.length, "two traditions must never share a shape");
});

test("no icon in this module is a swastika, in any encoding", () => {
  // U+0FD5–U+0FD8 are the Tibetan swastika signs; U+5350 卐 and U+534D 卍 are the
  // CJK ideographs. The symbol is legitimate and ancient in Jain use, but this
  // atlas is public and international, where it reads on sight as the Nazi
  // appropriation. Shapes carry tradition here instead — see icons.ts.
  const BANNED = [0x0fd5, 0x0fd6, 0x0fd7, 0x0fd8, 0x5350, 0x534d];

  const strings = [
    ...Object.keys(COUNTRY_CODES), ...Object.values(COUNTRY_CODES),
    FLAG_FALLBACK, ICON_VIEWBOX, ROUTE_VIEWBOX, ERA_VAR_FALLBACK,
    ...Object.values(TRADITION_ICONS).flatMap((g: Glyph) => [g.shape, g.d]),
    ...Object.values(ROUTE_ICONS).flatMap((g: Glyph) => [g.shape, g.d]),
    TRADITION_FALLBACK.shape, TRADITION_FALLBACK.d,
    ...CORPUS_COUNTRIES.map(flagOf), ...CORPUS_TRADITIONS.map((t) => traditionIconOf(t)),
    ...ERAS.map((_, i) => eraVar(i)),
  ];
  for (const value of strings) {
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      assert.ok(!BANNED.includes(cp), `U+${cp.toString(16).toUpperCase()} (swastika) in ${JSON.stringify(value)}`);
    }
  }

  // Belt and braces: the source file itself, comments and all, so the codepoint
  // cannot return through a constant this list forgets to cover.
  const source = readFileSync(new URL("./icons.ts", import.meta.url), "utf8");
  for (const cp of BANNED) {
    assert.ok(
      !source.includes(String.fromCodePoint(cp)),
      `icons.ts contains U+${cp.toString(16).toUpperCase()} — the swastika must never ship`,
    );
  }
});

test("an unknown tradition falls back to a shape no tradition owns", () => {
  for (const input of ["Zoroastrian", "", "  ", "hindu", "HINDU"]) {
    assert.equal(traditionIconOf(input), TRADITION_FALLBACK.d, `${JSON.stringify(input)} must fall back`);
  }
  assert.equal(traditionIconOf(undefined), TRADITION_FALLBACK.d);
  assert.equal(traditionIconOf(null), TRADITION_FALLBACK.d);
  assert.equal(traditionIconOf(7 as unknown as string), TRADITION_FALLBACK.d, "a non-string must not throw");
  // Crucially it is NOT the circle: falling back to a legend shape would label
  // an unknown tradition "Hindu" on sight.
  const legend = Object.values(TRADITION_ICONS).map((g) => g.shape);
  assert.ok(!legend.includes(TRADITION_FALLBACK.shape as never), "the fallback must not borrow a legend shape");
});

test("every glyph is one non-empty fill path in the 11×11 legend box", () => {
  assert.equal(ICON_VIEWBOX, "0 0 11 11");
  for (const glyph of [...Object.values(TRADITION_ICONS), TRADITION_FALLBACK]) {
    assert.match(glyph.d, /^M/, "a path must start with a move");
    assert.ok(glyph.d.length > 8, "a path must actually draw something");
    // Coordinates stay inside the box the CSS sizes at 11px.
    for (const n of glyph.d.match(/-?\d+(?:\.\d+)?/g) ?? []) {
      assert.ok(Math.abs(Number(n)) <= 11, `${n} falls outside the ${ICON_VIEWBOX} box`);
    }
  }
});

// ---------------------------------------------------------------------------
// circuits & dynasties — structural devices, never invented symbols
// ---------------------------------------------------------------------------

test("the route glyph says only how many members a circuit has", () => {
  assert.equal(routeIcon(12), ROUTE_ICONS.network);
  assert.equal(routeIcon(2), ROUTE_ICONS.network);
  assert.equal(routeIcon(1), ROUTE_ICONS.single);
  assert.equal(routeIcon(0), ROUTE_ICONS.single);
  assert.notEqual(ROUTE_ICONS.network.d, ROUTE_ICONS.single.d);
});

test("routeIcon degrades rather than throwing on a nonsense count", () => {
  for (const n of [-1, 0.5, NaN, Infinity, -Infinity]) {
    const glyph = routeIcon(n);
    assert.ok(glyph.d.length > 0, `${n} must still yield a drawable glyph`);
  }
  assert.equal(routeIcon(NaN), ROUTE_ICONS.single, "not a number is not a network");
  assert.equal(routeIcon(Infinity), ROUTE_ICONS.single, "no circuit has infinite members either");
});

test("eraVar returns a palette token for every era and a neutral outside them", () => {
  ERAS.forEach((_, i) => assert.equal(eraVar(i), `var(--e${i + 1})`));
  assert.equal(eraVar(ERAS.length), ERA_VAR_FALLBACK, "past the last era there is no colour to use");
  assert.equal(eraVar(-1), ERA_VAR_FALLBACK, "eraIndex returns -1 past the final boundary");
  assert.equal(eraVar(1.5), ERA_VAR_FALLBACK);
  assert.equal(eraVar(NaN), ERA_VAR_FALLBACK);
  // globals.css defines --e1..--e6 only; a seventh era must not reference --e7.
  assert.equal(ERAS.length, 6, "add --e7 to globals.css before adding a seventh era");
});
