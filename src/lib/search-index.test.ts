import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEARCH_INDEX, loadSignificance, type IndexedSite } from "./search-index.ts";
import { RECORD_COUNT, COLUMNS } from "./generated/search-index.ts";
import { TEXT, RECORD_COUNT as TEXT_COUNT } from "./generated/search-index-text.ts";
import { buildColumns, COLUMN_ORDER } from "../../scripts/build-search-index.mjs";
import {
  facetsOf, filterSites, matches, groupByValues, visibleFacetKeys, EMPTY_QUERY,
  FACET_KEYS, type FacetKey, type Searchable,
} from "./search.ts";
import { slugify } from "./site-utils.ts";

/**
 * The corpus is read as text, not imported: a JSON import needs an import
 * attribute that tsc will not emit, which is the same reason site-utils.ts keeps
 * data out of its helpers. Reading it here is the point of these tests — the
 * index is only trustworthy if it still says what data/sites.json says.
 */
type Corpus = readonly Record<string, unknown>[];
/** buildColumns still returns every column; the generator is what splits them. */
const textColumnOf = (columns: Record<string, string[]>) => columns.significance;

const CORPUS: Corpus = JSON.parse(
  readFileSync(new URL("../../data/sites.json", import.meta.url), "utf8"),
);

/** Exactly the fields `search.ts` reads out of a record, per `Searchable`. */
const SEARCHED_TEXT = [
  "name", "alt", "native", "country", "state", "place",
  "tradition", "deity", "dynasty", "style",
] as const;

/** What a list page renders on top of what it searches. */
const RENDERED = ["id", "builtDisplay"] as const;

test("the index holds one record per corpus record, in corpus order", () => {
  assert.equal(SEARCH_INDEX.length, CORPUS.length);
  assert.equal(RECORD_COUNT, CORPUS.length);
  assert.deepEqual(
    SEARCH_INDEX.map((s) => s.id),
    CORPUS.map((s) => s.id),
    "order must be preserved — filterSites promises it and the gazetteer relies on it",
  );
});

test("the deferred text column matches the core index row for row", () => {
  assert.equal(TEXT_COUNT, RECORD_COUNT, "the two halves must describe the same corpus");
  assert.equal(TEXT.length, CORPUS.length);
  TEXT.forEach((value, i) => assert.equal(value, CORPUS[i].significance ?? "",
    `${CORPUS[i].id}: deferred significance must be verbatim`));
});

test("every generated column is as long as the corpus", () => {
  // `significance` lives in the deferred chunk, covered by the test above.
  for (const field of COLUMN_ORDER.filter((f: string) => f !== "significance")) {
    const column = (COLUMNS as unknown as Record<string, readonly unknown[]>)[field];
    assert.ok(Array.isArray(column), `column ${field} is missing from the generated file`);
    assert.equal(column.length, CORPUS.length, `column ${field} is the wrong length`);
  }
});

test("every field search.ts reads round-trips verbatim from the corpus", () => {
  for (let i = 0; i < CORPUS.length; i++) {
    const source = CORPUS[i];
    const indexed = SEARCH_INDEX[i] as unknown as Record<string, unknown>;
    for (const field of [...SEARCHED_TEXT, ...RENDERED]) {
      // The generator writes "" for an absent optional field and search-index.ts
      // turns it back into undefined, so both sides normalise to undefined.
      const expected = source[field] === "" ? undefined : source[field];
      assert.equal(indexed[field], expected, `${String(source.id)}.${field}`);
    }
    assert.deepEqual(indexed.built, source.built, `${String(source.id)}.built`);
    assert.deepEqual(indexed.circuits, source.circuits ?? [], `${String(source.id)}.circuits`);
  }
});

test("the index carries nothing a list page does not read", () => {
  // The whole point of T-066: `story` alone is 48 kB of prose that search.ts
  // never looks at. If one of these reappears, the payload regressed.
  const banned = ["story", "sources", "lat", "lng", "access", "wiki", "patron",
    "disputedCircuits", "status", "origin", "originNote", "website", "phone", "verified"];
  const keys = new Set(Object.keys(SEARCH_INDEX[0]));
  for (const field of banned) assert.ok(!keys.has(field), `${field} leaked into the index`);
  assert.deepEqual(
    [...keys].sort(),
    [...SEARCHED_TEXT, ...RENDERED, "built", "circuits", "tier", "deities", "deityGroup"].sort(),
  );
});

test("searching the index gives the same answers as searching the corpus", async () => {
  // Parity only holds once the deferred text has landed — before that the index
  // deliberately searches fewer fields, which is the whole point of the split.
  await loadSignificance();
  const corpusRecords = CORPUS as unknown as readonly Searchable[];
  const queries = [
    "", "meenakshi", "shree", "temple madurai", "chola", "brihadisvara",
    "granite vimana", "unesco", "inscriptions", "பெருவுடையார்", "nothingmatchesthis",
  ];
  for (const q of queries) {
    assert.deepEqual(
      filterSites(SEARCH_INDEX, { q }).map((s) => s.id),
      filterSites(corpusRecords, { q }).map((s) => (s as unknown as { id: string }).id),
      `query ${JSON.stringify(q)} must match the same records`,
    );
  }
});

test("faceting the index gives the same counts as faceting the corpus", () => {
  const fromIndex = facetsOf(SEARCH_INDEX);
  const fromCorpus = facetsOf(CORPUS as unknown as readonly Searchable[]);
  for (const key of FACET_KEYS) assert.deepEqual(fromIndex[key], fromCorpus[key], `facet ${key}`);
});

test("a record with no significance is indexed, not rejected", () => {
  // Constitution rule 2: an unsourced fact is omitted, so a record may legitimately
  // arrive with no significance. That must not break the build or the search.
  const bare = {
    id: "bare-record", name: "Bare Record", country: "India", state: "Kerala",
    place: "Nowhere", tradition: "Hindu", deity: "Shiva", dynasty: "Unknown",
    style: "Kerala", built: [900, 950], builtDisplay: "10th c.",
  };
  const columns = buildColumns([bare]);
  assert.equal(textColumnOf(columns)[0], "", "absent significance becomes an empty column entry");
  assert.equal(columns.alt[0], "");
  assert.equal(columns.native[0], "");
  assert.equal(columns.tier[0], "");
  assert.deepEqual(columns.circuits[0], []);

  // And the record still searches on the fields it does have.
  const record: Searchable = { ...bare, significance: textColumnOf(columns)[0], circuits: [] };
  assert.equal(matches(record, "bare"), true);
  assert.equal(matches(record, "nowhere shiva"), true);
  assert.equal(matches(record, "vimana"), false);
});

test("a record with no significance survives the whole projection", () => {
  const withoutSignificance = CORPUS.map((s) => {
    const { significance: _dropped, ...rest } = s;
    return rest;
  });
  const columns = buildColumns(withoutSignificance);
  assert.equal(textColumnOf(columns).length, CORPUS.length);
  assert.ok(textColumnOf(columns).every((value: string) => value === ""));
  assert.deepEqual(columns.name, CORPUS.map((s) => s.name), "the other columns are unaffected");
});

test("the generator refuses a record with no id or name", () => {
  const usable = { id: "x", name: "X", built: [1, 2] };
  assert.throws(() => buildColumns([{ ...usable, id: undefined }]), /has no id/);
  assert.throws(() => buildColumns([{ ...usable, name: "" }]), /has no name/);
  assert.throws(() => buildColumns([{ ...usable, built: [1] }]), /built/);
});

test("the generator is deterministic", () => {
  // The artifact is gitignored and rebuilt by prebuild/predev/pretest, so two
  // runs over the same corpus must produce byte-identical output or `--check`
  // fails for reasons that have nothing to do with the data.
  const once = JSON.stringify(buildColumns(CORPUS));
  const twice = JSON.stringify(buildColumns(CORPUS));
  assert.equal(once, twice);
});

test("the generated file is marked as generated", () => {
  const source = readFileSync(new URL("./generated/search-index.ts", import.meta.url), "utf8");
  assert.match(source, /^\/\/ GENERATED FILE — DO NOT EDIT BY HAND\./, "banner must be the first line");
  assert.match(source, /scripts\/build-search-index\.mjs/, "banner must name the generator");
});

test("IndexedSite is assignable to Searchable", () => {
  // A compile-time assertion with a runtime shape check behind it: this is the
  // contract that lets filterSites/facetsOf/matches work on the index unchanged.
  const asSearchable: readonly Searchable[] = SEARCH_INDEX;
  const first: IndexedSite = SEARCH_INDEX[0];
  assert.equal(asSearchable.length, SEARCH_INDEX.length);
  // Deliberately NOT asserted as undefined here: loadSignificance() mutates the
  // shared records in place, so whether it has run depends on test order. What
  // must hold either way is that the value is never invented — it is absent, or
  // it is the corpus text verbatim.
  assert.ok(
    first.significance === undefined || first.significance === CORPUS[0].significance,
    "significance is either deferred or verbatim — never synthesised",
  );
  assert.equal(typeof first.id, "string");
  assert.equal(Object.isFrozen(SEARCH_INDEX), true, "the index array is frozen");
});

test("the critical-path chunk carries no significance at all", () => {
  // Order-independent, unlike an assertion on a mutated record: this reads the
  // generated file. If significance ever leaks back into the core chunk, the
  // 208.7 kB saving silently disappears and only this catches it.
  const core = readFileSync(new URL("./generated/search-index.ts", import.meta.url), "utf8");
  assert.ok(!/"significance"/.test(core), "significance must live in the deferred chunk only");
  const text = readFileSync(new URL("./generated/search-index-text.ts", import.meta.url), "utf8");
  assert.match(text, /export const TEXT/, "the deferred chunk must export TEXT");
});

// ===========================================================================
// deity tags — `deities` and `deityGroup`
// ===========================================================================
//
// EVERY test below builds its own records. None of them reads data/sites.json,
// and that is deliberate rather than lazy: the tags are generated onto the
// corpus by a separate step, so the working tree can legitimately hold a corpus
// where NOTHING is tagged. A test written against the real corpus would then
// pass vacuously — zero tagged records means zero facets means every assertion
// about empty chips and correct counts holds trivially — and would go on passing
// after the tagging broke. Fixtures assert the behaviour whatever the data does.

/** A minimal record; `over` supplies whatever the test is actually about. */
const rec = (over: Partial<Searchable> & { id?: string }): Searchable & { id: string } => ({
  id: "r", name: "Some Temple", country: "India", state: "Tamil Nadu", place: "Somewhere",
  tradition: "Hindu", deity: "Unspecified", dynasty: "Unknown", style: "Dravidian",
  built: [1000, 1050], significance: "", ...over,
} as Searchable & { id: string });

const countIn = (facets: ReturnType<typeof facetsOf>, key: "deity" | "group", value: string) =>
  facets[key].find((f) => f.value === value)?.count ?? 0;

test("an untagged record joins no deity facet and no stream facet", () => {
  // The 6% of records whose dedication names no figure: relic stupas, monastic
  // universities, "Parabrahma, worshipped without image". They must vanish from
  // these facets entirely rather than pool into an "unknown" bucket.
  const sites = [
    rec({ id: "tagged", deity: "Shiva", deities: ["Shiva"], deityGroup: "Shaiva" }),
    rec({ id: "stupa", deity: "Relic stupa (Mahathupa)" }),
    rec({ id: "empty-array", deity: "Monastic university", deities: [] }),
  ];
  const facets = facetsOf(sites);
  assert.equal(facets.deity.length, 1, "only the tagged record contributes a deity value");
  assert.deepEqual(facets.deity, [{ value: "Shiva", count: 1 }]);
  assert.deepEqual(facets.group, [{ value: "Shaiva", count: 1 }]);
  // No bucket anywhere is holding the untagged pair.
  const totalDeity = facets.deity.reduce((n, f) => n + f.count, 0);
  const totalGroup = facets.group.reduce((n, f) => n + f.count, 0);
  assert.equal(totalDeity, 1);
  assert.equal(totalGroup, 1);
  assert.ok(!facets.deity.some((f) => /unknown|other|none|—|-/i.test(f.value)),
    "no placeholder value may be invented for the untagged records");
});

test("an untagged record renders no deity chip", () => {
  // DeityChips in SiteFilters.tsx returns null on exactly this condition, so the
  // condition is what is asserted here: absent and [] are both "no chips", and
  // neither may fall back to the free-text deity.
  const noChips = (s: { deities?: readonly string[] }) => (s.deities ?? []).length === 0;
  assert.equal(noChips(rec({ deity: "Relic stupa" })), true, "absent -> no chips");
  assert.equal(noChips(rec({ deity: "Monastic university", deities: [] })), true, "[] -> no chips");
  assert.equal(noChips(rec({ deity: "Shiva", deities: ["Shiva"] })), false);
});

test("an untagged record is still findable, and still filterable on everything else", () => {
  // Not being tagged must cost the record nothing except the deity facet.
  const stupa = rec({ id: "ruwanwelisaya", name: "Ruwanwelisaya", place: "Anuradhapura",
    country: "Sri Lanka", tradition: "Buddhist", deity: "Relic stupa (Mahathupa)" });
  assert.equal(matches(stupa, "ruwanwelisaya"), true);
  assert.equal(matches(stupa, "anuradhapura"), true);
  assert.deepEqual(filterSites([stupa], { tradition: "Buddhist" }).map((s) => s.id), ["ruwanwelisaya"]);
  // ...but a deity filter must exclude it, rather than letting it through.
  assert.deepEqual(filterSites([stupa], { deity: "Gautama Buddha" }), []);
});

test("deity facet counts sum correctly across multi-tagged records", () => {
  // `deity` is multi-valued, so its counts sum HIGHER than the record count;
  // `group` is single-valued, so its counts sum to the tagged records exactly.
  const sites = [
    rec({ id: "a", deities: ["Shiva", "Parvati"], deityGroup: "Shakta" }),
    rec({ id: "b", deities: ["Shiva"], deityGroup: "Shaiva" }),
    rec({ id: "c", deities: ["Shiva"], deityGroup: "Shaiva" }),
    rec({ id: "d", deities: ["Vishnu"], deityGroup: "Vaishnava" }),
    rec({ id: "e" }),
  ];
  const facets = facetsOf(sites);
  assert.equal(countIn(facets, "deity", "Shiva"), 3);
  assert.equal(countIn(facets, "deity", "Parvati"), 1);
  assert.equal(countIn(facets, "deity", "Vishnu"), 1);
  assert.equal(facets.deity.reduce((n, f) => n + f.count, 0), 5, "4 records, 5 tags between them");
  assert.equal(facets.group.reduce((n, f) => n + f.count, 0), 4, "one group per TAGGED record");
  assert.equal(sites.length, 5, "and one record contributes to neither");
});

test("deity facet counts match what filtering by that value actually returns", () => {
  // The count on a dropdown option is a promise about the result set. This is
  // the test that catches the two drifting apart.
  const sites = [
    rec({ id: "a", deities: ["Shiva", "Parvati"], deityGroup: "Shakta" }),
    rec({ id: "b", deities: ["Shiva"], deityGroup: "Shaiva" }),
    rec({ id: "c", deities: ["Vishnu"], deityGroup: "Vaishnava" }),
    rec({ id: "d" }),
  ];
  const facets = facetsOf(sites);
  for (const { value, count } of facets.deity) {
    assert.equal(filterSites(sites, { deity: value }).length, count, `deity=${value}`);
  }
  for (const { value, count } of facets.group) {
    assert.equal(filterSites(sites, { group: value }).length, count, `group=${value}`);
  }
});

test("searching finds a record by its canonical tag and by its stream", () => {
  // The point of putting the tags in the haystack: "Murugan" reaches a record
  // whose deity string only says "Swaminathaswamy", and "Shakta" reaches a
  // goddess temple that never uses the word.
  const swamimalai = rec({
    id: "swamimalai", name: "Swaminathaswamy Temple", place: "Swamimalai",
    deity: "Swaminathaswamy", deities: ["Murugan"], deityGroup: "Shaiva",
  });
  assert.equal(matches(swamimalai, "Murugan"), true, "reached by the tag, not by the deity text");
  assert.equal(matches(swamimalai, "murugan"), true, "and case-insensitively");

  const kamakhya = rec({
    id: "kamakhya", name: "Kamakhya Temple", place: "Guwahati",
    deity: "Kamakhya", deities: ["Devi"], deityGroup: "Shakta",
  });
  assert.equal(matches(kamakhya, "Shakta"), true, "reached by the stream");
  assert.equal(matches(kamakhya, "shakta guwahati"), true, "and the stream ANDs with other words");

  // An untagged record must NOT be swept in by either.
  const stupa = rec({ id: "stupa", name: "Great Stupa", deity: "Relic stupa" });
  assert.equal(matches(stupa, "Murugan"), false);
  assert.equal(matches(stupa, "Shakta"), false);
});

test("the deity facet disappears entirely when no record carries a tag", () => {
  // This is the state of data/sites.json until the deity-tag branch merges, and
  // the state of any fresh data wave before the tag generator has run. Two empty
  // dropdowns advertising a filter that cannot filter is worse than none.
  const untagged = [
    rec({ id: "a", deity: "Shiva", state: "Tamil Nadu" }),
    rec({ id: "b", deity: "Vishnu", state: "Kerala" }),
  ];
  const facets = facetsOf(untagged);
  assert.deepEqual(facets.deity, [], "no values at all, not a value meaning 'none'");
  assert.deepEqual(facets.group, []);

  const order: FacetKey[] = ["deity", "group", "tradition", "era", "country", "state"];
  const shown = visibleFacetKeys(order, facets, EMPTY_QUERY);
  assert.ok(!shown.includes("deity"), "the Deity dropdown must not render");
  assert.ok(!shown.includes("group"), "nor the Tradition-stream dropdown");
  assert.ok(shown.includes("state"), "while a facet that CAN narrow still renders");
});

test("a facet with one value is hidden unless it is the one in use", () => {
  const sites = [rec({ id: "a", deities: ["Shiva"], deityGroup: "Shaiva" })];
  const facets = facetsOf(sites);
  const order: FacetKey[] = ["deity", "group"];
  assert.deepEqual(visibleFacetKeys(order, facets, EMPTY_QUERY), [],
    "one value cannot narrow anything");
  assert.deepEqual(visibleFacetKeys(order, facets, { ...EMPTY_QUERY, deity: "Shiva" }), ["deity"],
    "but the active filter must stay on screen so it can be cleared");
});

test("groupByValues gives allDeities its shape, and skips untagged records", () => {
  // allDeities()/allDeityGroups() in sites.ts are this function applied to the
  // corpus; sites.ts itself cannot be imported here (it loads data at module
  // scope), so the grouping is tested where it is actually defined.
  const sites = [
    rec({ id: "a", deities: ["Shiva", "Parvati"] }),
    rec({ id: "b", deities: ["Shiva"] }),
    rec({ id: "c", deities: ["Vishnu"] }),
    rec({ id: "d" }),
    rec({ id: "e", deities: [] }),
  ];
  const grouped = groupByValues(sites, (s) => s.deities ?? []);
  assert.deepEqual(grouped.map(([name, rs]) => [name, rs.length]),
    [["Shiva", 2], ["Parvati", 1], ["Vishnu", 1]], "largest first, ties by name");
  const listed = new Set(grouped.flatMap(([, rs]) => rs.map((r) => (r as { id: string }).id)));
  assert.ok(!listed.has("d") && !listed.has("e"), "untagged records appear under no deity");
});

test("groupByValues is stable and deterministic across rebuilds", () => {
  // The sitemap and generateStaticParams both derive from this ordering; if two
  // equal-sized tags could swap places, every rebuild would churn the sitemap.
  const sites = [
    rec({ id: "a", deities: ["Kali"] }), rec({ id: "b", deities: ["Durga"] }),
    rec({ id: "c", deities: ["Brahma"] }), rec({ id: "d", deities: ["Shiva"] }),
    rec({ id: "e", deities: ["Shiva"] }),
  ];
  const once = groupByValues(sites, (s) => s.deities ?? []).map(([n]) => n);
  const twice = groupByValues([...sites].reverse(), (s) => s.deities ?? []).map(([n]) => n);
  assert.deepEqual(once, ["Shiva", "Brahma", "Durga", "Kali"]);
  assert.deepEqual(twice, once, "input order must not change the output order");
});

test("deity slugs are collision-free and round-trip back to their tag", () => {
  // /deity/[slug] finds its record by comparing slugify(name) to the slug, so a
  // collision would silently serve one deity's sites under another's URL.
  const tags = ["Shiva", "Vishnu", "Devi", "Gautama Buddha", "Guru Granth Sahib",
    "Guru Gobind Singh", "Guru Tegh Bahadur", "Guru Nanak", "Guru Arjan",
    "Tripura Sundari", "Avalokiteshvara", "Rishabhanatha", "Parshvanatha",
    "Tara", "Naga", "Navagraha", "Sai Baba", "Mariamman", "Bahubali"];
  const slugs = tags.map(slugify);
  assert.equal(new Set(slugs).size, tags.length, "every tag must slug to something distinct");
  for (const slug of slugs) {
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${slug} must be URL-safe`);
  }
  for (const tag of tags) {
    assert.equal(tags.filter((t) => slugify(t) === slugify(tag)).length, 1, `${tag} resolves uniquely`);
  }
  // The corpus's own tags, whatever they currently are, must satisfy the same
  // rule. Vacuous while nothing is tagged; load-bearing the moment something is.
  const live = [...new Set(SEARCH_INDEX.flatMap((s) => s.deities ?? []))];
  assert.equal(new Set(live.map(slugify)).size, live.length,
    `deity slugs collide in the live corpus: ${live.join(", ")}`);
});

test("both new fields round-trip through the generated index verbatim", () => {
  const sites = [
    { id: "a", name: "A", built: [1, 2], deities: ["Shiva", "Parvati"], deityGroup: "Shakta" },
    { id: "b", name: "B", built: [1, 2], deities: ["Vishnu"], deityGroup: "Vaishnava" },
    { id: "c", name: "C", built: [1, 2] },
  ];
  const columns = buildColumns(sites);
  assert.deepEqual(columns.deities, [["Shiva", "Parvati"], ["Vishnu"], []],
    "an untagged record emits [], never a placeholder tag");
  assert.deepEqual(columns.deityGroup, ["Shakta", "Vaishnava", ""],
    "and an absent group emits '', which search-index.ts folds back to undefined");
});

test("the deity columns ride the critical path, not the deferred chunk", () => {
  // Facets are counted before anyone types. If these ever moved into the
  // significance chunk, the Deity dropdown would render empty on page load and
  // silently fill in on the first keystroke. Read from the generated files so
  // this cannot be fooled by module state.
  const core = readFileSync(new URL("./generated/search-index.ts", import.meta.url), "utf8");
  // The emitted type declaration is the readable half; the payload beside it is
  // a JSON string, so its keys appear backslash-escaped and are a poor thing to
  // assert on.
  assert.match(core, /readonly deities:/, "deities must be in the critical-path chunk");
  assert.match(core, /readonly deityGroup:/, "deityGroup must be in the critical-path chunk");
  assert.ok(COLUMN_ORDER.includes("deities") && COLUMN_ORDER.includes("deityGroup"));

  // And they must NOT have leaked into the deferred chunk, which holds one
  // bare TEXT array and nothing else.
  const deferred = readFileSync(new URL("./generated/search-index-text.ts", import.meta.url), "utf8");
  assert.ok(!/readonly deities:/.test(deferred), "deities must not be deferred");
  assert.ok(!/readonly deityGroup:/.test(deferred), "deityGroup must not be deferred");
});

test("every corpus record's tags survive the projection into the index", () => {
  // Vacuous on an untagged corpus, and the assertion that matters the moment the
  // tags land: the index must say exactly what data/sites.json says.
  for (let i = 0; i < CORPUS.length; i++) {
    const source = CORPUS[i] as { id: string; deities?: string[]; deityGroup?: string };
    const indexed = SEARCH_INDEX[i];
    assert.deepEqual(indexed.deities, source.deities ?? [], `${source.id}.deities`);
    assert.equal(indexed.deityGroup, source.deityGroup || undefined, `${source.id}.deityGroup`);
  }
});
