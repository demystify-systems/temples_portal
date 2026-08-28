import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEARCH_INDEX, loadSignificance, type IndexedSite } from "./search-index.ts";
import { RECORD_COUNT, COLUMNS } from "./generated/search-index.ts";
import { TEXT, RECORD_COUNT as TEXT_COUNT } from "./generated/search-index-text.ts";
import { buildColumns, COLUMN_ORDER } from "../../scripts/build-search-index.mjs";
import { facetsOf, filterSites, matches, FACET_KEYS, type Searchable } from "./search.ts";

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
  assert.deepEqual([...keys].sort(), [...SEARCHED_TEXT, ...RENDERED, "built", "circuits", "tier"].sort());
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
