import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  answerSnippet,
  sentences,
  siteDescription,
  siteKeywords,
  siteTitle,
  truncateAtWord,
} from "./seo.ts";

/** A record shaped like the corpus's own: Brihadisvara, Thanjavur. */
const brihadisvara = {
  name: "Brihadisvara Temple",
  place: "Thanjavur",
  state: "Tamil Nadu",
  deity: "Shiva (Brihadisvara)",
  builtDisplay: "1003–1010 CE",
  dynasty: "Chola",
  style: "Dravida",
  circuits: ["Paadal Petra Sthalam", "UNESCO World Heritage"],
  significance:
    "The masterpiece of Chola imperial architecture, completed in 1010 CE by Rajaraja I at the height of Chola power. Its 66 m granite vimana was the tallest structure in India for centuries, and its walls carry some of the most detailed temple inscriptions ever cut, recording staff, dancers, and endowments.",
};

test("truncateAtWord stays inside the budget and cuts on a word boundary", () => {
  const value = "Its 66 m granite vimana was the tallest structure in India for centuries";
  const out = truncateAtWord(value, 40);
  assert.ok(out.length <= 40, `"${out}" is ${out.length} chars`);
  assert.ok(out.endsWith("…"));
  const kept = out.slice(0, -1);
  assert.ok(value.startsWith(kept), "the kept text must be a verbatim prefix");
  assert.equal(value[kept.length], " ", "the cut must land on a space, not mid-word");
});

test("truncateAtWord leaves a value that already fits untouched", () => {
  assert.equal(truncateAtWord("Brihadisvara Temple", 40), "Brihadisvara Temple");
});

test("sentences does not split on initials or the corpus's own 'c.' abbreviation", () => {
  // A description cut after "Arthur C." would read as a fabricated fragment.
  assert.deepEqual(
    sentences("Divers (among them Arthur C. Clarke in 1956) recovered idols. Held c. 3rd c. BCE by tradition."),
    ["Divers (among them Arthur C. Clarke in 1956) recovered idols.", "Held c. 3rd c. BCE by tradition."],
  );
});

test("sentences does split after a regnal numeral", () => {
  // "…Rajendra Chola I. It is also revered…" is two sentences, not an initial.
  assert.deepEqual(sentences("Expanded by Rajendra Chola I. It is also revered as a Shakti pitha."), [
    "Expanded by Rajendra Chola I.",
    "It is also revered as a Shakti pitha.",
  ]);
});

test("siteTitle emits the full form when it fits the 60-char bound", () => {
  assert.equal(siteTitle(brihadisvara), "Brihadisvara Temple, Thanjavur — 1003–1010 CE Chola temple");
});

test("siteTitle drops clauses rather than eliding, and never exceeds the bound", () => {
  // Real corpus shape: multi-clause builtDisplay, multi-clause place.
  const srirangam = {
    name: "Ranganathaswamy Temple",
    place: "Srirangam, Tiruchirappalli",
    builtDisplay: "built up 10th–17th c.; Rajagopuram 1987",
    dynasty: "Chola",
  };
  const title = siteTitle(srirangam)!;
  assert.ok(title.length <= TITLE_MAX_LENGTH, `"${title}" is ${title.length} chars`);
  assert.ok(title.startsWith("Ranganathaswamy Temple, Srirangam"), title);
  assert.ok(!title.includes("…"), "a shorter honest form beats an ellipsis");
  assert.ok(!title.includes("Rajagopuram"), "the dropped clause must not survive");
});

test("siteTitle truncates on a word boundary once no clause is left to drop", () => {
  const name = "Arulmigu Ramanathaswamy Thirukkoil Mahasamprokshanam Memorial Temple";
  const title = siteTitle({ name })!;
  assert.ok(title.length <= TITLE_MAX_LENGTH, `"${title}" is ${title.length} chars`);
  assert.ok(title.endsWith("…"));
  const kept = title.slice(0, -1);
  assert.ok(name.startsWith(kept));
  assert.equal(name[kept.length], " ", "the cut must land on a space, not mid-word");
});

test("siteTitle returns null when the record has no name", () => {
  assert.equal(siteTitle({ place: "Thanjavur", dynasty: "Chola" }), null);
  assert.equal(siteTitle({ name: "   " }), null);
});

test("siteTitle ignores the corpus's '—' not-established placeholder", () => {
  // "—" is the corpus's marker for a dynasty nobody has established. Printing it
  // as a fact ("… — 1003–1010 CE — temple") would assert something no source does.
  const title = siteTitle({ ...brihadisvara, dynasty: "—" })!;
  assert.equal(title, "Brihadisvara Temple, Thanjavur — 1003–1010 CE temple");
});

test("siteDescription returns significance verbatim when it already fits", () => {
  const short = "An old Shiva temple in Nizamabad town that draws large crowds at Shivaratri.";
  assert.equal(siteDescription({ name: "X", significance: short }), short);
});

test("siteDescription does not pad a short significance to reach 150 chars", () => {
  const short = "An old Shiva temple in Nizamabad town that draws large crowds at Shivaratri.";
  const out = siteDescription({ name: "X", significance: short })!;
  assert.ok(out.length < DESCRIPTION_MIN_LENGTH, "a short source stays short");
  assert.equal(out, short, "no invented clause may be appended");
});

test("siteDescription lands in the 150–160 window for a long significance", () => {
  const out = siteDescription(brihadisvara)!;
  assert.ok(out.length <= DESCRIPTION_MAX_LENGTH, `${out.length} chars: "${out}"`);
  assert.ok(out.length >= DESCRIPTION_MIN_LENGTH, `${out.length} chars: "${out}"`);
});

test("siteDescription prefers a whole sentence over an elided cut", () => {
  const significance =
    "A Pandya-era shrine whose granite vimana carries inscriptions recording daily worship, the dancers endowed to it, and the villages assigned to feed them. A later Nayak mandapa closes the outer court, and the gopuram was raised again in the nineteenth century.";
  const out = siteDescription({ name: "X", significance })!;
  assert.ok(out.endsWith("them."), `expected a clean sentence end, got "${out}"`);
  assert.ok(!out.includes("…"));
});

test("siteDescription NEVER draws from story — legend is not a page summary (rule 3)", () => {
  // The two records differ only in `story`. If the legend could ever reach the
  // description, these would diverge — and the site would be publishing katha as
  // documented history, which is exactly what the constitution forbids.
  const withoutLegend = { name: "Brihadisvara Temple", significance: brihadisvara.significance };
  const withLegend = {
    ...withoutLegend,
    story: "Tradition holds the 80-tonne kalasha was hauled up a ramp kilometres long.",
  };
  assert.equal(siteDescription(withLegend), siteDescription(withoutLegend));
  assert.ok(!siteDescription(withLegend)!.includes("kalasha"));
  assert.ok(!siteDescription(withLegend)!.includes("Tradition"));
});

test("siteDescription returns null for a record with only a story, never the story", () => {
  const legendOnly = { name: "Some Shrine", story: "The deity is said to have appeared to a cowherd here." };
  assert.equal(siteDescription(legendOnly), null);
});

test("siteDescription returns null when significance is missing or blank", () => {
  assert.equal(siteDescription({ name: "Some Shrine" }), null);
  assert.equal(siteDescription({ name: "Some Shrine", significance: "   " }), null);
  assert.equal(siteDescription({ name: "Some Shrine", significance: "—" }), null);
});

test("siteKeywords draws only from deity, dynasty, style, state and circuits", () => {
  assert.deepEqual(siteKeywords(brihadisvara), [
    "Shiva",
    "Brihadisvara",
    "Chola",
    "Dravida",
    "Tamil Nadu",
    "Paadal Petra Sthalam",
    "UNESCO World Heritage",
  ]);
});

test("siteKeywords never contains an empty or whitespace-only string", () => {
  const messy = {
    deity: "Vishnu ()",
    dynasty: "—",
    style: "   ",
    state: "",
    circuits: ["", "  ", "Divya Desam"],
  };
  const keywords = siteKeywords(messy);
  for (const keyword of keywords) {
    assert.notEqual(keyword.trim(), "", `empty keyword in ${JSON.stringify(keywords)}`);
  }
  assert.deepEqual(keywords, ["Vishnu", "Divya Desam"]);
});

test("siteKeywords dedupes case-insensitively and drops prose-length values", () => {
  const site = {
    deity: "Shiva (shiva)",
    dynasty: "Chola",
    style: "Kashmiri stone temple architecture: central shrine in a colonnaded courtyard with corner shrines",
    circuits: ["CHOLA"],
  };
  assert.deepEqual(siteKeywords(site), ["Shiva", "Chola"]);
});

test("siteKeywords returns an empty list, not an invented term, when no field carries one", () => {
  assert.deepEqual(siteKeywords({ name: "Some Shrine" }), []);
});

test("answerSnippet frames the name and date around verbatim significance", () => {
  const answer = answerSnippet(brihadisvara)!;
  assert.ok(answer.startsWith("Brihadisvara Temple (1003–1010 CE) — "), answer);
  const body = answer.slice("Brihadisvara Temple (1003–1010 CE) — ".length);
  assert.ok(brihadisvara.significance.startsWith(body), "the body must be lifted verbatim");
  assert.ok(body.length <= ANSWER_MAX_LENGTH);
});

test("answerSnippet gives one sentence when two would overflow the budget", () => {
  const first =
    "A granite shrine recorded in inscriptions of the tenth century, rebuilt after the Vijayanagara period, and expanded again by the Nayaks who added the outer prakara and the thousand-pillared mandapa.";
  const second =
    "The later gopuram was raised in the nineteenth century by the local zamindar, whose endowments are recorded on its base in Tamil and Grantha script.";
  const answer = answerSnippet({ name: "X", significance: `${first} ${second}` })!;
  assert.equal(answer, `X — ${first}`);
  assert.ok(!answer.includes("…"), "a whole sentence beats an elided pair");
});

test("answerSnippet omits the date frame when the record is undated", () => {
  const answer = answerSnippet({ name: "Some Shrine", significance: "A hilltop shrine recorded in 1823." })!;
  assert.equal(answer, "Some Shrine — A hilltop shrine recorded in 1823.");
});

test("answerSnippet returns null when there is no sourced history, however rich the legend", () => {
  const legendOnly = {
    name: "Some Shrine",
    builtDisplay: "c. 1500 CE",
    story: "The deity is said to have appeared to a cowherd here.",
  };
  assert.equal(answerSnippet(legendOnly), null);
});
