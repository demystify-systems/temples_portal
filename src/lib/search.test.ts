import test from "node:test";
import assert from "node:assert/strict";
import {
  normalise, tokenise, SYNONYMS, SYNONYM_GROUPS, expandToken, deityAliases,
  matches, matchQuality, facetsOf, filterSites, filterAndFacet, isActive, eraName,
  EMPTY_QUERY, FACET_KEYS,
  type FacetKey, type SearchQuery, type Searchable,
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
  deities: ["Parvati", "Shiva"], deityGroup: "Shakta",
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
  deities: ["Vishnu"], deityGroup: "Vaishnava",
  dynasty: "Vijayanagara", style: "Dravida",
  circuits: ["Divya Desam"], tier: "compact",
  significance: "The most-visited pilgrimage site in the world.",
  built: [850, 1600],
};

const ISHVARA: Searchable = {
  name: "Ishvara Temple, Arasikere",
  country: "India", state: "Karnataka", place: "Arasikere, Hassan",
  tradition: "Hindu", deity: "Shiva (linga known as Kattamesvara)",
  deities: ["Shiva"], deityGroup: "Shaiva",
  dynasty: "Hoysala", style: "Hoysala", circuits: [], tier: "compact",
  significance: "A sixteen-pointed star-shaped vimana, unique among Hoysala shrines.",
  built: [1220, 1220],
};

/** A Perumal (Vishnu) shrine whose deity text never says "Vishnu". */
const KARUNAKARA: Searchable = {
  name: "Thirukkaragam (Karunakara Perumal shrine)",
  country: "India", state: "Tamil Nadu", place: "Kanchipuram",
  tradition: "Hindu", deity: "Karunakara Perumal",
  deities: ["Vishnu"], deityGroup: "Vaishnava",
  dynasty: "Pallava", style: "Dravidian",
  circuits: ["Divya Desam"], tier: "compact",
  significance: "One of the Divya Desams inside the Ulagalantha Perumal complex.",
  built: [750, 850],
};

/**
 * Carries NO deity tags, exactly as the corpus record does not: "Mandala-mountain
 * (504 Buddhas)" names no single figure, so the tag generator leaves it alone
 * rather than inventing one. It is the untagged case in every assertion below.
 */
const BOROBUDUR: Searchable = {
  name: "Borobudur",
  country: "Indonesia", place: "Magelang, Central Java",
  tradition: "Buddhist", deity: "Mandala-mountain (504 Buddhas)",
  dynasty: "Sailendra", style: "Candi",
  circuits: ["UNESCO World Heritage"],
  significance: "The largest Buddhist monument in the world.",
  built: [780, 833],
};

/** The record the reported bug was about, copied field-for-field from data/sites.json. */
const JAGANNATH: Searchable = {
  name: "Shri Jagannath Temple, Puri",
  native: "\u0b36\u0b4d\u0b30\u0b40 \u0b1c\u0b17\u0b28\u0b4d\u0b28\u0b3e\u0b25 \u0b2e\u0b28\u0b4d\u0b26\u0b3f\u0b30",
  country: "India", state: "Odisha", place: "Puri",
  tradition: "Hindu",
  deity: "Jagannath (Krishna) with Balabhadra & Subhadra",
  dynasty: "Eastern Ganga", style: "Kalinga (65 m deul)",
  circuits: ["Char Dham"],
  significance: "Eastern seat of the Char Dham, whose wooden deities are unlike any other in Hinduism.",
  built: [1135, 1230],
};

/**
 * JAGANNATH is deliberately NOT in CORPUS: the assertions below count exact
 * records, and a sixth fixture would rewrite them for no gain. The fuzzy tests
 * build their own small corpus from it.
 */
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

// The three principalDeities tests that stood here are deleted with the
// heuristic itself. It classified the free-text deity into ten coarse labels and
// backed the deity facet; the corpus now carries real `deities` tags and a
// second, disagreeing classifier is worse than one with holes. deityAliases
// keeps only its text-splitting job, covered above. The tag-driven facet is
// tested in search-index.test.ts, against fixtures.

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
  // Meenakshi is tagged both Parvati and Shiva, so the deity facet counts it
  // twice — while Borobudur, tagged with nothing, is counted nowhere.
  const deityTotal = facets.deity.reduce((sum, f) => sum + f.count, 0);
  assert.equal(deityTotal, CORPUS.reduce((sum, s) => sum + (s.deities ?? []).length, 0));
  const tagged = CORPUS.filter((s) => (s.deities ?? []).length > 0).length;
  assert.ok(deityTotal > tagged, `deity counts summed to ${deityTotal}, expected > ${tagged} tagged records`);
  assert.ok(tagged < CORPUS.length, "the fixture set must include an untagged record");

  // group is single-valued, so it sums to the tagged records and no further.
  const groupTotal = facets.group.reduce((sum, f) => sum + f.count, 0);
  assert.equal(groupTotal, CORPUS.filter((s) => s.deityGroup).length);
});

test("facetsOf returns every key and counts the values correctly", () => {
  const facets = facetsOf(CORPUS);
  assert.deepEqual(Object.keys(facets).sort(), [...FACET_KEYS].sort());
  assert.deepEqual(facets.tradition, [{ value: "Hindu", count: 4 }, { value: "Buddhist", count: 1 }]);
  assert.deepEqual(facets.country, [{ value: "India", count: 4 }, { value: "Indonesia", count: 1 }]);
  assert.deepEqual(facets.deity.find((f) => f.value === "Vishnu"), { value: "Vishnu", count: 2 });
  assert.deepEqual(facets.deity.find((f) => f.value === "Parvati"), { value: "Parvati", count: 1 });
  assert.deepEqual(facets.group.find((f) => f.value === "Vaishnava"), { value: "Vaishnava", count: 2 });
  // Borobudur carries no tag, so it appears under no deity and no stream.
  assert.equal(facets.deity.reduce((n, f) => n + f.count, 0), 5);
  assert.equal(facets.group.reduce((n, f) => n + f.count, 0), 4);
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
  assert.deepEqual(filterSites(CORPUS, { group: "Vaishnava" }), [VENKATESWARA, KARUNAKARA]);
  assert.deepEqual(filterSites(CORPUS, { group: "Shakta" }), [MEENAKSHI]);
  // The untagged record is reachable by every facet EXCEPT the deity ones.
  assert.deepEqual(filterSites(CORPUS, { tradition: "Buddhist" }), [BOROBUDUR]);
  assert.deepEqual(filterSites(CORPUS, { deity: "Gautama Buddha" }), []);
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

// --------------------------------------------------------------------------
// transliteration tolerance (fuzzy.ts)
//
// Reported from the live assistant, measured against the real 2,791-record
// corpus: "where is jaganath temple" returned 0 records and was REFUSED, while
// "where is jagannath temple" — one more `n` — returned the temple. Indic names
// have no single English spelling, and a visitor types what they heard.
//
// The fold is a FALLBACK throughout. Nothing below may reach a record that the
// exact and synonym passes could not already reach on a correct spelling.
// --------------------------------------------------------------------------

const FUZZY_CORPUS: readonly Searchable[] = [JAGANNATH, MEENAKSHI, ISHVARA, BOROBUDUR];

test("a misspelled Indic name reaches the record the correct spelling reaches", () => {
  for (const spelling of ["jaganath", "jagannatha", "jagganath"]) {
    const hits = filterSites(FUZZY_CORPUS, { q: spelling });
    assert.deepEqual(hits, [JAGANNATH], `"${spelling}" must reach Shri Jagannath Temple`);
  }
});

test("matchQuality separates what was typed correctly from what was folded", () => {
  assert.equal(matchQuality(JAGANNATH, "jagannath"), "exact", "the spelling the record carries");
  assert.equal(matchQuality(JAGANNATH, "jaganath"), "fuzzy", "reached only through the fold");
  assert.equal(matchQuality(JAGANNATH, "angkor"), "none", "not in the record at all");
  assert.equal(matchQuality(JAGANNATH, "   "), "exact", "an empty query matches everything, exactly");
});

test("one folded word in an otherwise exact query makes the whole match fuzzy", () => {
  assert.equal(matchQuality(JAGANNATH, "jaganath puri"), "fuzzy");
  assert.equal(matchQuality(JAGANNATH, "jagannath puri"), "exact");
});

test("filterSites returns every exact match before any fuzzy one", () => {
  const hits = filterSites([MEENAKSHI, ISHVARA], { q: "temple" });
  assert.deepEqual(hits, [MEENAKSHI, ISHVARA], "an all-exact result keeps input order");

  // A record that spells the name the other way and says it nowhere else,
  // placed FIRST in the input so only the match tier can reorder it.
  const variant: Searchable = {
    ...ISHVARA, name: "Jaganath Deula", place: "Kendrapara", deity: "Krishna", significance: "A brick deula.",
  };
  const mixed = filterSites([variant, JAGANNATH], { q: "jagannath" });
  assert.deepEqual(
    mixed.map((s) => s.name),
    ["Shri Jagannath Temple, Puri", "Jaganath Deula"],
    "someone who spelled it correctly must not be pushed below a folded match",
  );
});

test("the fold does not widen a query that already matched nothing", () => {
  // Both words are in the corpus, never in one record. AND semantics hold.
  assert.deepEqual(filterSites(CORPUS, { q: "meenakshi karnataka" }), []);
  assert.deepEqual(filterSites(FUZZY_CORPUS, { q: "angkor wat cambodia" }), []);
  assert.deepEqual(filterSites(FUZZY_CORPUS, { q: "eiffel tower paris" }), []);
});

test("the fold never merges two different short place names", () => {
  const puri: Searchable = { ...ISHVARA, name: "Test Temple", place: "Puri", state: "Odisha" };
  const pune: Searchable = { ...ISHVARA, name: "Test Temple", place: "Pune", state: "Maharashtra" };
  assert.deepEqual(filterSites([puri, pune], { q: "puri" }), [puri]);
  assert.deepEqual(filterSites([puri, pune], { q: "pune" }), [pune]);
});

test("folding is never applied to a record's facet values, only to free text", () => {
  // A facet is a controlled value chosen from a list, not something typed.
  assert.deepEqual(filterSites(FUZZY_CORPUS, { country: "Indea" }), [], "no near-miss facets");
  assert.deepEqual(filterSites(FUZZY_CORPUS, { tradition: "Hindoo" }), []);
});

test("matches stays a boolean view of matchQuality", () => {
  assert.equal(matches(JAGANNATH, "jaganath"), true);
  assert.equal(matches(JAGANNATH, "angkor"), false);
  assert.equal(matches(JAGANNATH, ""), true);
});

// --------------------------------------------------------------------------
// the precedence ladder
//
// The reported bug, in fixtures: "thirupathi" returned Pataleeswarar Temple at
// Thirupathiripuliyur ABOVE Sri Venkateswara Temple, Tirumala. Both are real
// matches and only one is what was meant. The discriminator is whole word vs
// fragment of a longer word — never name vs place, which would answer this
// query by breaking "temples in Madurai".
// --------------------------------------------------------------------------

/** Copied field-for-field from data/sites.json: the record that wrongly won. */
const PATALEESWARAR: Searchable = {
  name: "Pataleeswarar Temple",
  country: "India", state: "Tamil Nadu", place: "Thirupathiripuliyur, Cuddalore",
  tradition: "Hindu", deity: "Shiva (Pataleeswarar)",
  deities: ["Shiva"], deityGroup: "Shaiva",
  dynasty: "Chola", style: "Dravida",
  circuits: ["Paadal Petra Sthalam"], tier: "compact",
  significance: "A Paadal Petra Sthalam on the north bank of the Gadilam.",
  built: [900, 1200],
};

const LADDER: readonly Searchable[] = [PATALEESWARAR, VENKATESWARA];

test("a whole word beats a fragment of a longer word, even when the fragment is exact", () => {
  // "thirupathi" is an exact SUBSTRING of "thirupathiripuliyur", and reaches
  // Tirumala's "Tirupati" only by folding. The fold still wins: one names a
  // place, the other is the first ten letters of somewhere else.
  const hits = filterSites(LADDER, { q: "thirupathi" });
  assert.deepEqual(
    hits.map((s) => s.name),
    ["Sri Venkateswara Temple, Tirumala", "Pataleeswarar Temple"],
    "the folded whole word must outrank the exact fragment",
  );
});

test("the fragment is still a result — demoted, never dropped", () => {
  assert.equal(filterSites(LADDER, { q: "thirupathi" }).length, 2);
  assert.ok(matches(PATALEESWARAR, "thirupathi"), "recall is unchanged; only the order moved");
});

test("the ladder is not 'name beats place' — the place still wins when it is the answer", () => {
  // Tirumala carries the word in its PLACE and Pataleeswarar in its place too;
  // swap the question and the name-bearing record must not automatically win.
  assert.deepEqual(filterSites(LADDER, { q: "cuddalore" }), [PATALEESWARAR]);
  assert.deepEqual(filterSites(CORPUS, { q: "madurai" }), [MEENAKSHI], "place-only queries still work");
});

test("an exact spelling the record stores beats one it only folds to", () => {
  // Both fold to "tirupati". VENKATESWARA STORES "Tirupati"; the other is
  // spelled "Thiruppathy" and meets the query in a key neither of them is.
  const thiruppathy: Searchable = { ...ISHVARA, name: "Irattai Thiruppathy", place: "Thoothukudi", deity: "Vishnu" };
  const hits = filterSites([thiruppathy, VENKATESWARA], { q: "thirupathi" });
  assert.deepEqual(
    hits.map((s) => s.place),
    ["Tirumala, Tirupati", "Thoothukudi"],
    "one normalisation from what was typed beats two, whatever field it lands in",
  );
});

test("the word as typed outranks a synonym spelling, wherever each falls", () => {
  // The synonym in the NAME, and no "Vishnu" anywhere on the record — which is
  // what an untagged Perumal shrine looks like. VENKATESWARA carries the typed
  // word only in its deity, the LIGHTER field, and must still win: synonym
  // expansion widens what can be reached, it does not outrank what was meant.
  const perumal: Searchable = {
    ...ISHVARA, name: "Karunakara Perumal Temple", deity: "Karunakara Perumal",
    deities: [], deityGroup: undefined, significance: "A Divya Desam shrine.",
  };
  const hits = filterSites([perumal, VENKATESWARA], { q: "vishnu" });
  assert.deepEqual(
    hits.map((s) => s.name),
    ["Sri Venkateswara Temple, Tirumala", "Karunakara Perumal Temple"],
    "the Perumal shrine is still found, just second",
  );
});

test("a whole word outranks the same word as a prefix", () => {
  const meen: Searchable = { ...ISHVARA, name: "Meenakshi Sundareswarar Temple", place: "Alagar Koil" };
  const exact: Searchable = { ...ISHVARA, name: "Meena Temple", place: "Alwarthirunagari" };
  assert.deepEqual(
    filterSites([meen, exact], { q: "meena" }).map((s) => s.name),
    ["Meena Temple", "Meenakshi Sundareswarar Temple"],
  );
});

test("within one tier, the field decides: name before place before prose", () => {
  const named: Searchable = { ...ISHVARA, name: "Chola Temple", significance: "A shrine." };
  const placed: Searchable = { ...ISHVARA, name: "A Temple", place: "Cholapuram Chola", significance: "A shrine." };
  const told: Searchable = { ...ISHVARA, name: "B Temple", place: "Kumbakonam", significance: "Built by the Chola kings." };
  // Deliberately fed in the WRONG order, so only the ladder can sort them.
  assert.deepEqual(
    filterSites([told, placed, named], { q: "chola" }).map((s) => s.name),
    ["Chola Temple", "A Temple", "B Temple"],
  );
});

test("a query is only as well answered as its worst-answered word", () => {
  const both: Searchable = { ...ISHVARA, name: "Meenakshi Madurai Temple", significance: "A shrine." };
  const split: Searchable = { ...ISHVARA, name: "Meenakshi Temple", place: "Madurai", significance: "A shrine." };
  const buried: Searchable = { ...ISHVARA, name: "Some Temple", place: "Trichy", significance: "Near Meenakshi at Madurai." };
  assert.deepEqual(
    filterSites([buried, split, both], { q: "meenakshi madurai" }).map((s) => s.name),
    ["Meenakshi Madurai Temple", "Meenakshi Temple", "Some Temple"],
  );
});

test("the ladder never rescues a query the corpus does not answer", () => {
  for (const q of ["xyzzy", "capital france", "angkor wat cambodia", "1998 world cup"]) {
    assert.deepEqual(filterSites(CORPUS, { q }), [], `must find nothing for: ${q}`);
  }
});

test("matchQuality still reports folding, even though the fold outranks a fragment", () => {
  assert.equal(matchQuality(VENKATESWARA, "thirupathi"), "fuzzy", "reached by folding the spelling");
  assert.equal(matchQuality(PATALEESWARAR, "thirupathi"), "exact", "the letters are there, as a fragment");
  assert.equal(matchQuality(VENKATESWARA, "tirupati"), "exact");
});

// --------------------------------------------------------------------------
// filterAndFacet — one traversal, identical answers
//
// SiteFilters used to call filterSites nine times per keystroke: once for the
// results, then once per facet key, because each dropdown's counts are taken
// against the results of every OTHER filter. That shape IS the specification,
// so it is the oracle these tests check the one-pass version against.
// --------------------------------------------------------------------------

const NINE_PASSES = (sites: readonly Searchable[], query: SearchQuery) => ({
  results: filterSites(sites, query),
  facets: Object.fromEntries(
    FACET_KEYS.map((key) => [key, facetsOf(filterSites(sites, { ...query, [key]: "" }))[key]]),
  ) as Record<FacetKey, unknown>,
});

/** Every shape of query the panel can be in: none, text, facet, and both. */
const QUERY_CASES: readonly SearchQuery[] = [
  {},
  EMPTY_QUERY,
  { q: "temple" },
  { q: "vishnu" },
  { q: "meenakshi madurai" },
  { q: "thirupathi" },
  { q: "xyzzy" },
  { country: "India" },
  { deity: "Shiva" },
  { tradition: "Buddhist" },
  { country: "India", state: "Tamil Nadu" },
  { country: "India", deity: "Vishnu", q: "temple" },
  { q: "temple", tradition: "Hindu", era: "Late medieval" },
  { country: "Nepal" },
];

const FACETED: readonly Searchable[] = [...CORPUS, JAGANNATH];

test("filterAndFacet returns exactly what nine separate passes returned", () => {
  for (const query of QUERY_CASES) {
    const one = filterAndFacet(FACETED, query);
    const nine = NINE_PASSES(FACETED, query);
    assert.deepEqual(one.results, nine.results, `results differ for ${JSON.stringify(query)}`);
    for (const key of FACET_KEYS) {
      assert.deepEqual(one.facets[key], nine.facets[key], `${key} counts differ for ${JSON.stringify(query)}`);
    }
  }
});

test("a set facet still counts its own alternatives — choosing one never empties its list", () => {
  // The whole reason each facet excludes itself: with Tamil Nadu chosen, the
  // state dropdown must still offer Odisha, or the reader cannot change their
  // mind without clearing first.
  const view = filterAndFacet(FACETED, { state: "Tamil Nadu" });
  assert.ok(view.facets.state.some((f) => f.value === "Odisha"), "the other states survive");
  assert.ok(view.facets.state.some((f) => f.value === "Tamil Nadu"));
  // ...while every OTHER facet is counted against the Tamil Nadu records only.
  assert.deepEqual(view.facets.country, [{ value: "India", count: 2 }]);
  assert.deepEqual(view.results, filterSites(FACETED, { state: "Tamil Nadu" }));
});

test("two set facets narrow each other's counts, and neither narrows itself", () => {
  const view = filterAndFacet(FACETED, { country: "India", tradition: "Hindu" });
  // `country` is counted with only `tradition` applied, so Indonesia is gone
  // (Borobudur is Buddhist) but India is still there to be re-chosen.
  assert.deepEqual(view.facets.country.map((f) => f.value), ["India"]);
  assert.ok(view.facets.tradition.some((f) => f.value === "Hindu"));
});

test("filterAndFacet never mutates its input and preserves corpus order among equals", () => {
  const input = [...FACETED];
  const view = filterAndFacet(input, { q: "temple" });
  assert.deepEqual(input, [...FACETED], "input array untouched");
  assert.deepEqual(view.results, view.results.slice().sort((a, b) => input.indexOf(a) - input.indexOf(b)));
});

test("filterAndFacet on an empty corpus returns empty lists, not undefined", () => {
  const view = filterAndFacet([], { q: "shiva" });
  assert.deepEqual(view.results, []);
  for (const key of FACET_KEYS) assert.deepEqual(view.facets[key], []);
});
