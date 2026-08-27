import test from "node:test";
import assert from "node:assert/strict";
import {
  normalise, tokenise, SYNONYMS, SYNONYM_GROUPS, expandToken, deityAliases, principalDeities,
  matches, facetsOf, filterSites, isActive, eraName, EMPTY_QUERY, FACET_KEYS, type Searchable,
} from "./search.ts";

/**
 * Fixtures are copied field-for-field from data/sites.json so the assertions
 * are about real corpus text, without importing the corpus (which would need a
 * JSON import attribute the test runner does not accept).
 */
const MEENAKSHI: Searchable = {
  name: "Meenakshi Amman Temple",
  native: "மீனாட்சி அம்மன் கோயில்",
  country: "India", state: "Tamil Nadu", place: "Madurai",
  tradition: "Hindu",
  deity: "Meenakshi (Parvati) & Sundareswarar (Shiva)",
  dynasty: "Nayak", style: "Dravida",
  circuits: ["Paadal Petra Sthalam", "Shakti tradition"],
  tier: "compact",
  significance: "The great goddess-first temple of Tamil Nadu and the heart of Madurai.",
  built: [1560, 1655],
};

const VENKATESWARA: Searchable = {
  name: "Sri Venkateswara Temple, Tirumala",
  native: "తిరుమల శ్రీ వేంకటేశ్వర స్వామి దేవాలయం",
  country: "India", state: "Andhra Pradesh", place: "Tirumala, Tirupati",
  tradition: "Hindu", deity: "Venkateswara (Vishnu)",
  dynasty: "Vijayanagara", style: "Dravida",
  circuits: ["Divya Desam"], tier: "compact",
  significance: "The most-visited pilgrimage site in the world.",
  built: [850, 1600],
};

const ISHVARA: Searchable = {
  name: "Ishvara Temple, Arasikere",
  country: "India", state: "Karnataka", place: "Arasikere, Hassan",
  tradition: "Hindu", deity: "Shiva (linga known as Kattamesvara)",
  dynasty: "Hoysala", style: "Hoysala", circuits: [], tier: "compact",
  significance: "A sixteen-pointed star-shaped vimana, unique among Hoysala shrines.",
  built: [1220, 1220],
};

/** A Perumal (Vishnu) shrine whose deity text never says "Vishnu". */
const KARUNAKARA: Searchable = {
  name: "Thirukkaragam (Karunakara Perumal shrine)",
  country: "India", state: "Tamil Nadu", place: "Kanchipuram",
  tradition: "Hindu", deity: "Karunakara Perumal",
  dynasty: "Pallava", style: "Dravidian",
  circuits: ["Divya Desam"], tier: "compact",
  significance: "One of the Divya Desams inside the Ulagalantha Perumal complex.",
  built: [750, 850],
};

const BOROBUDUR: Searchable = {
  name: "Borobudur",
  country: "Indonesia", place: "Magelang, Central Java",
  tradition: "Buddhist", deity: "Buddha (Mahayana)",
  dynasty: "Sailendra", style: "Candi",
  circuits: ["UNESCO World Heritage"],
  significance: "The largest Buddhist monument in the world.",
  built: [780, 833],
};

const CORPUS: readonly Searchable[] = [MEENAKSHI, VENKATESWARA, ISHVARA, KARUNAKARA, BOROBUDUR];

// --------------------------------------------------------------------------
// normalise
// --------------------------------------------------------------------------

test("normalise strips diacritics, lowercases and collapses punctuation", () => {
  assert.equal(normalise("Śrī—Raṅgam!!"), "sri rangam");
  assert.equal(normalise("  BRIHADĪSVARA   Temple  "), "brihadisvara temple");
  assert.equal(normalise("Shiva & Pārvatī"), "shiva parvati");
});

test("normalise keeps non-Latin letters so native-script text stays searchable", () => {
  assert.equal(normalise("மீனாட்சி அம்மன்"), "மீனாட்சி அம்மன்");
});

test("tokenise drops empties left by punctuation runs", () => {
  assert.deepEqual(tokenise("Shiva (Brihadisvara) — linga!"), ["shiva", "brihadisvara", "linga"]);
  assert.deepEqual(tokenise("   "), []);
});

// --------------------------------------------------------------------------
// synonyms
// --------------------------------------------------------------------------

test("every synonym group member expands to every other member", () => {
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      const expansion = expandToken(term);
      for (const sibling of group) {
        assert.ok(expansion.includes(sibling), `"${term}" should expand to "${sibling}"`);
      }
    }
  }
});

test("groups that share a member are merged, so temple reaches koyil", () => {
  assert.ok(expandToken("temple").includes("koyil"), "temple/kovil and koil/kovil/koyil are one set");
  assert.ok(expandToken("koyil").includes("mandir"));
});

test("an unknown word expands to itself only", () => {
  assert.deepEqual(expandToken("borobudur"), ["borobudur"]);
});

test("SYNONYMS is keyed by normalised term", () => {
  for (const key of Object.keys(SYNONYMS)) assert.equal(key, normalise(key));
});

test("sri, shri, shree and sree are interchangeable in a query", () => {
  const found = ["sri", "shri", "shree", "sree"].map((v) => filterSites(CORPUS, { q: `${v} venkateswara` }));
  for (const hits of found) assert.deepEqual(hits, [VENKATESWARA]);
});

test("eeswarar matches a record spelled Ishvara", () => {
  assert.ok(matches(ISHVARA, "eeswarar"), "the ishwar/iswar/eshwar/eeswarar/isvara group is one set");
  assert.ok(matches(ISHVARA, "iswar"));
  assert.ok(matches(ISHVARA, "eshwar"));
});

test("a diacritic-free query reaches a record written with them, and back", () => {
  const rangam: Searchable = { ...ISHVARA, name: "Śrī Raṅganātha Temple" };
  assert.ok(matches(rangam, "sri ranganatha"), "query without diacritics finds record with them");
  assert.ok(matches(rangam, "Raṅganātha"), "query with diacritics finds the same record");
});

// --------------------------------------------------------------------------
// deity aliases
// --------------------------------------------------------------------------

test("deityAliases lifts the parenthetical out of free-text deity", () => {
  assert.ok(deityAliases("Azhagiya Manavalan (Vishnu)").includes("Vishnu"));
  assert.ok(deityAliases("Azhagiya Manavalan (Vishnu)").includes("Azhagiya Manavalan"), "and keeps the head");
});

test("deityAliases handles several parentheticals in one string", () => {
  const aliases = deityAliases("Meenakshi (Parvati) & Sundareswarar (Shiva)");
  assert.ok(aliases.includes("Parvati"));
  assert.ok(aliases.includes("Shiva"));
});

test("deityAliases adds the principal deity the epithet stands for", () => {
  assert.ok(deityAliases("Karunakara Perumal").includes("Vishnu"));
});

test("principalDeities reads several deities from one record", () => {
  assert.deepEqual([...principalDeities("Meenakshi (Parvati) & Sundareswarar (Shiva)")].sort(), ["Devi / Shakti", "Shiva"]);
});

test("principalDeities matches whole words, not substrings", () => {
  // "Ramanathaswamy" is Shiva; a substring rule would read the "rama" in it as Vishnu.
  assert.ok(!principalDeities("Shiva (Ramanathaswamy)").includes("Vishnu"));
  assert.deepEqual(principalDeities("Shiva (Ramanathaswamy)"), ["Shiva"]);
});

test("principalDeities returns nothing rather than guessing", () => {
  assert.deepEqual(principalDeities("Sacred confluence of the Alaknanda and Nandakini"), []);
  assert.deepEqual(principalDeities(""), []);
});

test("a Perumal shrine is found by searching Vishnu", () => {
  assert.ok(matches(KARUNAKARA, "vishnu"), "perumal/vishnu/narayana are one group");
  assert.deepEqual(filterSites(CORPUS, { q: "vishnu" }), [VENKATESWARA, KARUNAKARA]);
});

// --------------------------------------------------------------------------
// matching
// --------------------------------------------------------------------------

test("meenakshi finds the Madurai temple", () => {
  const hits = filterSites(CORPUS, { q: "meenakshi" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].place, "Madurai");
});

test("search covers place, state, country, dynasty, style and circuits", () => {
  assert.deepEqual(filterSites(CORPUS, { q: "madurai" }), [MEENAKSHI]);
  assert.deepEqual(filterSites(CORPUS, { q: "karnataka" }), [ISHVARA]);
  assert.deepEqual(filterSites(CORPUS, { q: "indonesia" }), [BOROBUDUR]);
  assert.deepEqual(filterSites(CORPUS, { q: "hoysala" }), [ISHVARA]);
  assert.deepEqual(filterSites(CORPUS, { q: "candi" }), [BOROBUDUR]);
  assert.deepEqual(filterSites(CORPUS, { q: "divya desam" }), [VENKATESWARA, KARUNAKARA]);
});

test("search covers significance, where the documented history lives", () => {
  assert.deepEqual(filterSites(CORPUS, { q: "vimana" }), [ISHVARA]);
});

test("words are ANDed, so extra words narrow the result", () => {
  assert.deepEqual(filterSites(CORPUS, { q: "temple" }), [MEENAKSHI, VENKATESWARA, ISHVARA]);
  assert.deepEqual(filterSites(CORPUS, { q: "temple tamil nadu" }), [MEENAKSHI]);
  assert.deepEqual(filterSites(CORPUS, { q: "meenakshi karnataka" }), []);
});

test("an empty or whitespace query returns everything", () => {
  assert.deepEqual(filterSites(CORPUS, {}), [...CORPUS]);
  assert.deepEqual(filterSites(CORPUS, { q: "" }), [...CORPUS]);
  assert.deepEqual(filterSites(CORPUS, { q: "   " }), [...CORPUS]);
  assert.deepEqual(filterSites(CORPUS, EMPTY_QUERY), [...CORPUS]);
  assert.equal(matches(BOROBUDUR, ""), true);
});

test("filterSites preserves input order and never mutates the input", () => {
  const input = [...CORPUS];
  const out = filterSites(input, { q: "temple" });
  assert.deepEqual(input, [...CORPUS], "input array is untouched");
  assert.deepEqual(out, out.slice().sort((a, b) => input.indexOf(a) - input.indexOf(b)));
});

// --------------------------------------------------------------------------
// facets
// --------------------------------------------------------------------------

test("single-valued facet counts sum to the number of records", () => {
  const facets = facetsOf(CORPUS);
  for (const key of ["tradition", "country"] as const) {
    const total = facets[key].reduce((sum, f) => sum + f.count, 0);
    assert.equal(total, CORPUS.length, `${key} counts must account for every record`);
  }
});

test("facets with an optional value account for exactly the records that have one", () => {
  const facets = facetsOf(CORPUS);
  const stateTotal = facets.state.reduce((sum, f) => sum + f.count, 0);
  assert.equal(stateTotal, CORPUS.filter((s) => s.state).length, "Borobudur has no state");
  const tierTotal = facets.tier.reduce((sum, f) => sum + f.count, 0);
  assert.equal(tierTotal, CORPUS.filter((s) => s.tier).length);
});

test("multi-valued facets may sum above the record count", () => {
  const facets = facetsOf(CORPUS);
  const circuitTotal = facets.circuit.reduce((sum, f) => sum + f.count, 0);
  assert.equal(circuitTotal, CORPUS.reduce((sum, s) => sum + (s.circuits ?? []).length, 0));
  // Meenakshi is both Devi and Shiva, so the deity facet counts it twice.
  const deityTotal = facets.deity.reduce((sum, f) => sum + f.count, 0);
  assert.ok(deityTotal > CORPUS.length, `deity counts summed to ${deityTotal}, expected > ${CORPUS.length}`);
});

test("facetsOf returns every key and counts the values correctly", () => {
  const facets = facetsOf(CORPUS);
  assert.deepEqual(Object.keys(facets).sort(), [...FACET_KEYS].sort());
  assert.deepEqual(facets.tradition, [{ value: "Hindu", count: 4 }, { value: "Buddhist", count: 1 }]);
  assert.deepEqual(facets.country, [{ value: "India", count: 4 }, { value: "Indonesia", count: 1 }]);
  assert.deepEqual(facets.deity.find((f) => f.value === "Vishnu"), { value: "Vishnu", count: 2 });
});

test("facets are ordered most-populous first, except eras which stay chronological", () => {
  const facets = facetsOf(CORPUS);
  const counts = facets.country.map((f) => f.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  assert.deepEqual(facets.era.map((f) => f.value), ["Early medieval", "High medieval", "Late medieval"]);
});

test("facetsOf on an empty set returns empty lists, not undefined", () => {
  const facets = facetsOf([]);
  for (const key of FACET_KEYS) assert.deepEqual(facets[key], []);
});

test("eraName reads the start of the built range", () => {
  assert.equal(eraName(BOROBUDUR), "Early medieval");
  assert.equal(eraName(MEENAKSHI), "Late medieval");
});

// --------------------------------------------------------------------------
// filtering
// --------------------------------------------------------------------------

test("each facet narrows on its own", () => {
  assert.deepEqual(filterSites(CORPUS, { tradition: "Buddhist" }), [BOROBUDUR]);
  assert.deepEqual(filterSites(CORPUS, { country: "Indonesia" }), [BOROBUDUR]);
  assert.deepEqual(filterSites(CORPUS, { state: "Tamil Nadu" }), [MEENAKSHI, KARUNAKARA]);
  assert.deepEqual(filterSites(CORPUS, { era: "Late medieval" }), [MEENAKSHI]);
  assert.deepEqual(filterSites(CORPUS, { circuit: "Divya Desam" }), [VENKATESWARA, KARUNAKARA]);
  assert.deepEqual(filterSites(CORPUS, { deity: "Vishnu" }), [VENKATESWARA, KARUNAKARA]);
});

test("facets and query compose", () => {
  assert.deepEqual(filterSites(CORPUS, { deity: "Vishnu", state: "Tamil Nadu" }), [KARUNAKARA]);
  assert.deepEqual(filterSites(CORPUS, { deity: "Vishnu", q: "tirumala" }), [VENKATESWARA]);
  assert.deepEqual(filterSites(CORPUS, { tradition: "Buddhist", state: "Tamil Nadu" }), []);
});

test("a facet value that no record carries yields nothing rather than everything", () => {
  assert.deepEqual(filterSites(CORPUS, { country: "Nepal" }), []);
  assert.deepEqual(filterSites(CORPUS, { deity: "Hanuman" }), []);
});

test("isActive reports whether anything would narrow the results", () => {
  assert.equal(isActive(EMPTY_QUERY), false);
  assert.equal(isActive({}), false);
  assert.equal(isActive({ q: "   " }), false, "whitespace is not a query");
  assert.equal(isActive({ q: "shiva" }), true);
  assert.equal(isActive({ country: "India" }), true);
  assert.equal(isActive({ ...EMPTY_QUERY, deity: "Shiva" }), true);
});
