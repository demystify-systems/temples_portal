import test from "node:test";
import assert from "node:assert/strict";
import {
  allPatrons,
  centuryOf,
  centurySpan,
  collapseSpace,
  findPatron,
  patronedSiteCount,
  patronKey,
  patronMentions,
  patronNameIn,
  patronSlug,
  patronSources,
  regionSpan,
  type PatronSite,
} from "./patrons.ts";

/** Minimal record in the shape the patron helpers read. */
const site = (id: string, patron: string | undefined, over: Partial<PatronSite> = {}): PatronSite => ({
  id,
  country: "India",
  state: "Tamil Nadu",
  built: [1000, 1000],
  sources: [{ l: `${id} source`, u: `https://example.org/${id}` }],
  ...(patron === undefined ? {} : { patron }),
  ...over,
});

test("collapseSpace trims and flattens any run of whitespace", () => {
  assert.equal(collapseSpace("  Rajaraja   I \n"), "Rajaraja I");
});

test("patronMentions reads a bare name as one patron", () => {
  assert.deepEqual(patronMentions("Rajaraja I"), ["Rajaraja I"]);
});

test("patronMentions splits semicolons and ampersands between real names", () => {
  assert.deepEqual(patronMentions("Anawrahta & Kyanzittha"), ["Anawrahta", "Kyanzittha"]);
  assert.deepEqual(patronMentions("Vimal Shah; Vastupala & Tejapala"), ["Vimal Shah", "Vastupala", "Tejapala"]);
});

test("patronMentions never invents a patron out of a trailing fragment", () => {
  // "successors" and "II" are not people the corpus names; splitting here would
  // manufacture patrons that no source attests (constitution rule 2).
  assert.deepEqual(patronMentions("Bhadravarman I & successors"), ["Bhadravarman I & successors"]);
  assert.deepEqual(patronMentions("Suryavarman I & II"), ["Suryavarman I & II"]);
});

test("patronMentions leaves an ampersand inside an annotation alone", () => {
  assert.deepEqual(patronMentions("Krishnadevaraya (gopuram & mandapa)"), ["Krishnadevaraya (gopuram & mandapa)"]);
});

test("patronMentions never splits commas or slashes, which are ambiguous here", () => {
  // "Dharna Shah, under Rana Kumbha" is one attribution, not two patrons.
  assert.deepEqual(patronMentions("Dharna Shah, under Rana Kumbha"), ["Dharna Shah, under Rana Kumbha"]);
  assert.deepEqual(patronMentions("Chilarai / Naranarayana"), ["Chilarai / Naranarayana"]);
});

test("patronMentions keeps each clause verbatim, so a reader can check it", () => {
  assert.deepEqual(patronMentions("Ahilyabai Holkar; gold domes by Ranjit Singh (1835)"), [
    "Ahilyabai Holkar",
    "gold domes by Ranjit Singh (1835)",
  ]);
});

test("patronNameIn strips a lower-case lead-in describing the gift, not the giver", () => {
  assert.equal(patronNameIn("gold domes by Ranjit Singh (1835)"), "Ranjit Singh");
  assert.equal(patronNameIn("expanded under Krishnadevaraya"), "Krishnadevaraya");
  assert.equal(patronNameIn("crown re-gilded by Mindon"), "Mindon");
  assert.equal(patronNameIn("Dharna Shah, under Rana Kumbha"), "Dharna Shah, under Rana Kumbha");
});

test("patronNameIn accepts an initialism but not a bare Roman numeral", () => {
  // A trust can be an all-caps name; "II" is half of one king's regnal number.
  assert.equal(patronNameIn("BAPS (Pramukh Swami Maharaj)"), "BAPS");
  assert.equal(patronNameIn("II"), "");
  assert.equal(patronNameIn("XIV"), "");
});

test("patronNameIn finds no patron in a clause that names none", () => {
  for (const clause of ["successors", "1835", "  ", "(rebuilt)"]) {
    assert.equal(patronNameIn(clause), "", `"${clause}" names no patron`);
  }
});

test("patronMentions yields nothing for an absent, empty or nameless field", () => {
  for (const value of [undefined, "", "   ", ";", "1835", "successors"]) {
    assert.deepEqual(patronMentions(value), [], `"${value}" must name no patron`);
  }
});

test("patronKey collapses honorifics and annotations into one identity", () => {
  const key = patronKey("Ahilyabai Holkar");
  assert.equal(patronKey("Rani Ahilyabai Holkar"), key);
  assert.equal(patronKey("Ahilyabai Holkar (temple rebuilt 1780)"), key);
  assert.equal(patronKey("  Ahilyabai   Holkar "), key);
});

test("patronKey keeps genuinely different patrons apart", () => {
  assert.notEqual(patronKey("Rajaraja I"), patronKey("Rajaraja II"));
  assert.notEqual(patronKey("Krishna I"), patronKey("Krishnadevaraya"));
  assert.notEqual(patronKey("Suryavarman I & II"), patronKey("Suryavarman II"));
});

test("patronKey never strips a title down to nothing", () => {
  assert.equal(patronKey("Queen"), "queen");
});

test("allPatrons collapses variant spellings into one patron", () => {
  const patrons = allPatrons([
    site("a", "Ahilyabai Holkar"),
    site("b", "Rani Ahilyabai Holkar"),
    site("c", "Ahilyabai Holkar (rebuilt 1780)"),
  ]);
  assert.equal(patrons.length, 1);
  assert.equal(patrons[0].sites.length, 3);
  // The longest name form wins the label; every recorded spelling is kept.
  assert.equal(patrons[0].name, "Rani Ahilyabai Holkar");
  assert.deepEqual(patrons[0].variants, [
    "Ahilyabai Holkar",
    "Ahilyabai Holkar (rebuilt 1780)",
    "Rani Ahilyabai Holkar",
  ]);
});

test("patronSlug is stable across every variant of a name", () => {
  const patrons = allPatrons([site("a", "Ahilyabai Holkar"), site("b", "Ahilya Bai Holkar")]);
  assert.equal(patrons.length, 2, "spacing differences are not merged — that would need a source");
  assert.equal(patronSlug("Rani Ahilyabai Holkar"), "rani-ahilyabai-holkar");
  assert.equal(patronSlug("K. Thamboosamy Pillai"), "k-thamboosamy-pillai");
  assert.equal(patronSlug("Vastupala & Tejapala"), "vastupala-and-tejapala");
  for (const name of ["Ashoka", "Rajaraja I", "R. N. Shetty", "  Mindon  "]) {
    const slug = patronSlug(name);
    assert.ok(!slug.startsWith("-") && !slug.endsWith("-"), `"${name}" -> "${slug}"`);
  }
});

test("allPatrons puts each patron's slug on its own patron record", () => {
  const patrons = allPatrons([site("a", "Maharaja Ranjit Singh (gold)")]);
  assert.equal(patrons[0].slug, patronSlug(patrons[0].name));
  assert.equal(findPatron(patrons, patrons[0].slug), patrons[0]);
  assert.equal(findPatron(patrons, "nobody"), undefined);
});

test("a patron's year range is derived from its sites, never asserted", () => {
  const patrons = allPatrons([
    site("a", "Ashoka", { built: [-262, 50] }),
    site("b", "Ashoka", { built: [-260, 200] }),
    site("c", "Someone Else", { built: [1900, 1901] }),
  ]);
  const ashoka = patrons.find((p) => p.name === "Ashoka")!;
  assert.deepEqual([...ashoka.built], [-262, 200], "min of built starts, max of built ends");
  assert.equal(centurySpan(ashoka.built), "3rd c. BCE – 2nd c. CE");
});

test("a patron's year range ignores sites it did not fund", () => {
  const patrons = allPatrons([site("a", "Rajaraja I", { built: [1003, 1010] }), site("b", undefined, { built: [200, 300] })]);
  assert.deepEqual([...patrons[0].built], [1003, 1010]);
});

test("patrons with no sites never appear", () => {
  const patrons = allPatrons([
    site("a", undefined),
    site("b", ""),
    site("c", "   "),
    site("d", "Rajaraja I"),
  ]);
  assert.deepEqual(patrons.map((p) => p.name), ["Rajaraja I"]);
  assert.ok(patrons.every((p) => p.sites.length > 0), "every patron listed must carry at least one site");
});

test("the total site count across patrons never exceeds the corpus", () => {
  const corpus = [
    site("a", "Ahilyabai Holkar"),
    site("b", "Anawrahta & Kyanzittha"),
    site("c", undefined),
    site("d", "Cholas; Krishnadevaraya (gopuram)"),
  ];
  const patrons = allPatrons(corpus);
  const covered = new Set(patrons.flatMap((p) => p.sites.map((s) => s.id)));
  assert.ok(covered.size <= corpus.length, "no patron may cite a site outside the corpus");
  assert.equal(covered.size, patronedSiteCount(corpus));
  assert.equal(covered.size, 3, "the record with no patron is not covered");
  for (const patron of patrons) {
    assert.ok(patron.sites.length <= corpus.length);
    const ids = patron.sites.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${patron.name} counts a site twice`);
  }
});

test("a patron reduced from a clause still shows the clause it came from", () => {
  const patrons = allPatrons([site("a", "Queen Shin Sawbu; crown re-gilded by Mindon")]);
  const mindon = patrons.find((p) => p.name === "Mindon")!;
  assert.deepEqual(mindon.variants, ["crown re-gilded by Mindon"], "the record's own words survive");
});

test("a compound field files its site under each patron it names, once each", () => {
  const patrons = allPatrons([site("a", "Gautamibai & Ahilyabai Holkar")]);
  assert.deepEqual(patrons.map((p) => p.name).sort(), ["Ahilyabai Holkar", "Gautamibai"]);
  assert.ok(patrons.every((p) => p.sites.length === 1));
});

test("allPatrons ranks by site count, then by name", () => {
  const patrons = allPatrons([
    site("a", "Zeta"),
    site("b", "Alpha"),
    site("c", "Beta"),
    site("d", "Beta"),
  ]);
  assert.deepEqual(patrons.map((p) => p.name), ["Beta", "Alpha", "Zeta"]);
});

test("allPatrons reports the countries and states its sites span", () => {
  const patrons = allPatrons([
    site("a", "Ashoka", { state: "Madhya Pradesh", country: "India" }),
    site("b", "Ashoka", { state: "Punjab", country: "Pakistan" }),
    site("c", "Jayavarman VII", { country: "Cambodia", state: undefined }),
  ]);
  const ashoka = patrons.find((p) => p.name === "Ashoka")!;
  assert.deepEqual([...ashoka.countries], ["India", "Pakistan"]);
  assert.deepEqual([...ashoka.states], ["Madhya Pradesh", "Punjab"]);
  const khmer = patrons.find((p) => p.name === "Jayavarman VII")!;
  assert.deepEqual([...khmer.states], [], "a site with no state contributes none");
  assert.equal(regionSpan(khmer), "Cambodia", "regionSpan falls back to countries");
});

test("patronSources dedupes citations across a patron's sites, keeping record order", () => {
  const shared = { l: "Shared", u: "https://example.org/shared" };
  const patrons = allPatrons([
    site("a", "Ashoka", { sources: [shared, { l: "A", u: "https://example.org/a" }] }),
    site("b", "Ashoka", { sources: [shared, { l: "B", u: "https://example.org/b" }] }),
  ]);
  assert.deepEqual(patronSources(patrons[0]).map((s) => s.u), [
    "https://example.org/shared",
    "https://example.org/a",
    "https://example.org/b",
  ]);
});

test("centuryOf places a year in its century on both sides of the era", () => {
  assert.deepEqual(centuryOf(1780), { n: 18, bce: false });
  assert.deepEqual(centuryOf(1800), { n: 18, bce: false }, "centuries are closed at their hundred");
  assert.deepEqual(centuryOf(1801), { n: 19, bce: false });
  assert.deepEqual(centuryOf(-650), { n: 7, bce: true });
  assert.deepEqual(centuryOf(-100), { n: 1, bce: true });
});

test("centurySpan reads a single century, a run, and a straddle of the era", () => {
  assert.equal(centurySpan([1780, 1787]), "18th c.");
  assert.equal(centurySpan([1003, 1565]), "11th–16th c.");
  assert.equal(centurySpan([-262, 50]), "3rd c. BCE – 1st c. CE");
  assert.equal(centurySpan([-300, -101]), "3rd–2nd c. BCE");
  assert.equal(centurySpan([2001, 2001]), "21st c.", "ordinals are not all 'th'");
});

test("regionSpan truncates a wide span rather than running off a phone screen", () => {
  const patrons = allPatrons(
    ["Andhra Pradesh", "Bihar", "Karnataka", "Odisha", "Tamil Nadu"].map((state, i) =>
      site(`s${i}`, "Wide Patron", { state }),
    ),
  );
  assert.equal(regionSpan(patrons[0]), "Andhra Pradesh · Bihar · Karnataka +2");
});
