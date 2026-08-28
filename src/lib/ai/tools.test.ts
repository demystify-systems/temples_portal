import test from "node:test";
import assert from "node:assert/strict";
import {
  TOOLS, TOOL_NAMES, executeTool, parseArgs, gapsOf, brief, full,
  NO_PHONE_NOTE, PHONE_NOTE, UNBACKED_PHONE_NOTE, NOT_FOUND_NOTE, NO_MATCH_NOTE, CONTESTED_NOTE,
  type ContactResult,
} from "./tools.ts";
import type { AtlasRecord } from "./retrieve.ts";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const mk = (over: Partial<AtlasRecord> & { id: string; name: string }): AtlasRecord => ({
  country: "India",
  place: "Somewhere",
  tradition: "Hindu",
  deity: "Shiva",
  dynasty: "Chola",
  style: "Dravida",
  significance: "A documented history paragraph.",
  built: [1000, 1100],
  builtDisplay: "11th century",
  lat: 10,
  lng: 78,
  sources: [{ l: "Wikipedia", u: "https://en.wikipedia.org/wiki/Example" }],
  ...over,
});

/** Rich record: official website, and a phone the website publishes. */
const TIRUMALA = mk({
  id: "venkateswara-tirumala",
  name: "Sri Venkateswara Temple, Tirumala",
  place: "Tirumala, Tirupati",
  state: "Andhra Pradesh",
  deity: "Venkateswara (Vishnu)",
  lat: 13.6833,
  lng: 79.3472,
  significance: "The most-visited religious site in the world; TTD runs the free-meal and prasadam operations.",
  story: "Venkateswara took a loan from Kubera for his wedding to Padmavati.",
  access: "22 km ghat road from Tirupati; darshan via TTD online booking.",
  website: "https://www.tirumala.org",
  phone: "+91-877-2233333",
  sources: [
    { l: "Wikipedia", u: "https://en.wikipedia.org/wiki/Venkateswara_Temple,_Tirumala" },
    { l: "TTD official", u: "https://www.tirumala.org" },
  ],
});

/** Compact record: no website, no phone, no access, no story. */
const KASHI = mk({
  id: "kashi-vishwanath",
  name: "Kashi Vishwanath Temple",
  place: "Varanasi",
  state: "Uttar Pradesh",
  deity: "Vishwanath (Shiva)",
  lat: 25.3109,
  lng: 83.0107,
  circuits: ["Jyotirlinga"],
  significance: "A Jyotirlinga on the Ganga at Varanasi, rebuilt in 1780 by Ahilyabai Holkar.",
  sources: [{ l: "Wikipedia", u: "https://en.wikipedia.org/wiki/Kashi_Vishwanath_Temple" }],
});

/** A number with no cited official website behind it — must be withheld (rule 4). */
const UNBACKED = mk({ id: "unbacked-phone", name: "Unbacked Temple", phone: "+91-99999-99999" });

const BAIDYANATH = mk({
  id: "baidyanath-deoghar",
  name: "Baidyanath Temple",
  place: "Deoghar",
  state: "Jharkhand",
  lat: 24.4924,
  lng: 86.7,
  circuits: ["Jyotirlinga"],
  disputedCircuits: [{
    circuit: "Jyotirlinga",
    status: "disputed",
    note: "Deoghar and Parli both claim the Vaidyanatha Jyotirlinga.",
    source: "https://en.wikipedia.org/wiki/Vaidyanath_Temple,_Deoghar",
  }],
});

const SOMNATH = mk({ id: "somnath", name: "Somnath Temple", place: "Prabhas Patan", lat: 20.888, lng: 70.401, circuits: ["Jyotirlinga"] });
const UNSOURCED = mk({ id: "unsourced-example", name: "Unsourced Temple", sources: [] });

const CORPUS: readonly AtlasRecord[] = [TIRUMALA, KASHI, UNBACKED, BAIDYANATH, SOMNATH, UNSOURCED];

/** Anything that could be read as a phone number. Used to prove none is invented. */
const PHONE_SHAPED = /\+?\d[\d\s().-]{6,}/;

const contactFor = (id: string): ContactResult =>
  executeTool("contactInfo", { id }, CORPUS).result as ContactResult;

// ---------------------------------------------------------------------------
// definitions
// ---------------------------------------------------------------------------

test("exactly the five specified tools are offered", () => {
  assert.deepEqual([...TOOL_NAMES], ["findSites", "siteDetail", "contactInfo", "nearbySites", "circuitMembers"]);
  assert.deepEqual(TOOLS.map((t) => t.function.name), [...TOOL_NAMES]);
});

test("every tool declares an object schema the provider can validate against", () => {
  for (const tool of TOOLS) {
    assert.equal(tool.type, "function");
    assert.ok(tool.function.description.length > 40, `${tool.function.name} needs a real description`);
    assert.equal((tool.function.parameters as { type: string }).type, "object");
    assert.equal((tool.function.parameters as { additionalProperties: boolean }).additionalProperties, false);
  }
});

test("the contact tool's description forbids composing a number, in the description itself", () => {
  const contact = TOOLS.find((t) => t.function.name === "contactInfo")!;
  assert.match(contact.function.description, /never compose|never .*reformat/i);
});

test("malformed tool arguments degrade to no arguments rather than throwing", () => {
  assert.deepEqual(parseArgs("{not json"), {});
  assert.deepEqual(parseArgs(undefined), {});
  assert.deepEqual(parseArgs('{"id":"somnath"}'), { id: "somnath" });
});

test("an unknown tool name is returned as data, not thrown", () => {
  const outcome = executeTool("dropTable", "{}", CORPUS);
  const result = outcome.result as { error: string; available: string[] };
  assert.match(result.error, /Unknown tool/);
  assert.deepEqual(result.available, [...TOOL_NAMES]);
  assert.deepEqual(outcome.cited, []);
});

// ---------------------------------------------------------------------------
// findSites
// ---------------------------------------------------------------------------

test("findSites returns nothing — and says so — for a site the atlas does not hold", () => {
  const outcome = executeTool("findSites", { query: "Angkor Wat" }, CORPUS);
  const result = outcome.result as { count: number; records: unknown[]; note: string };
  assert.equal(result.count, 0);
  assert.deepEqual(result.records, []);
  assert.equal(result.note, NO_MATCH_NOTE);
  assert.match(result.note, /do not substitute general knowledge/i);
  assert.deepEqual(outcome.cited, []);
});

test("every record findSites returns carries its own citations", () => {
  const outcome = executeTool("findSites", { query: "Temple" }, CORPUS);
  const result = outcome.result as { records: { id: string; sources: { l: string; u: string }[] }[] };
  assert.ok(result.records.length > 0);
  for (const record of result.records) {
    assert.ok(record.sources.length > 0, `${record.id} was returned without a source`);
  }
  for (const record of outcome.cited) {
    assert.ok(record.sources.length > 0, `${record.id} was cited without a source`);
  }
});

test("an uncited record is unreachable through the tools", () => {
  const outcome = executeTool("findSites", { query: "Unsourced Temple" }, CORPUS);
  assert.equal((outcome.result as { count: number }).count, 0);
  assert.equal((executeTool("siteDetail", { id: "unsourced-example" }, CORPUS).result as { found: boolean }).found, false);
});

// ---------------------------------------------------------------------------
// contactInfo — absence as data
// ---------------------------------------------------------------------------

test("contactInfo on a record with no phone returns the absence, and invents nothing", () => {
  const result = contactFor("kashi-vishwanath");

  assert.equal(result.site, "kashi-vishwanath");
  assert.equal(result.phone, null, "there is no phone, so the field is null");
  assert.deepEqual(result.missing, ["website", "phone", "access"]);
  assert.equal(result.note, NO_PHONE_NOTE);
  assert.equal(result.note, "No official phone is published for this site. We do not list unverified numbers.");

  // Nothing anywhere in the payload may look like a phone number.
  assert.ok(!PHONE_SHAPED.test(JSON.stringify(result)), `a number appeared: ${JSON.stringify(result)}`);
});

test("contactInfo quotes a published phone verbatim and names the website that publishes it", () => {
  const result = contactFor("venkateswara-tirumala");
  assert.equal(result.phone?.value, TIRUMALA.phone, "the number must be character-for-character the record's");
  assert.equal(result.phone?.source, TIRUMALA.website, "rule 4: the official website is the number's source");
  assert.equal(result.website?.value, "https://www.tirumala.org");
  assert.deepEqual(result.missing, []);
  assert.equal(result.note, PHONE_NOTE);
});

test("a phone with no cited official website behind it is withheld, not passed through", () => {
  const result = contactFor("unbacked-phone");
  assert.equal(result.phone, null, "rule 4 / G4: no cited website, no number");
  assert.ok(result.missing.includes("phone"));
  assert.equal(result.note, UNBACKED_PHONE_NOTE);
  assert.ok(!PHONE_SHAPED.test(JSON.stringify(result)), "the withheld number must not leak into the payload");
});

test("contactInfo for an unknown id refuses rather than guessing", () => {
  const result = contactFor("temple-that-does-not-exist");
  assert.equal(result.phone, null);
  assert.equal(result.website, null);
  assert.deepEqual(result.missing, ["website", "phone", "access"]);
  assert.equal(result.note, NOT_FOUND_NOTE);
  assert.match(result.note, /Do not answer from general knowledge/i);
});

// ---------------------------------------------------------------------------
// siteDetail — history and legend stay apart, gaps stay gaps
// ---------------------------------------------------------------------------

test("siteDetail keeps significance and story as separate fields", () => {
  const result = executeTool("siteDetail", { id: "venkateswara-tirumala" }, CORPUS).result as
    { significance: string; story: string };
  assert.equal(result.significance, TIRUMALA.significance);
  assert.equal(result.story, TIRUMALA.story);
  assert.ok(!result.significance.includes(TIRUMALA.story!), "the katha must never be folded into the history");
});

test("a compact record reports its gaps as gaps — no tier inflation", () => {
  const result = executeTool("siteDetail", { id: "kashi-vishwanath" }, CORPUS).result as
    { missing: string[]; note: string; story?: string; phone?: string };
  assert.deepEqual(result.missing, ["native", "patron", "origin", "story", "access", "website", "phone"]);
  assert.equal(result.story, undefined, "an absent field is absent, not an empty string to be filled");
  assert.match(result.note, /Never infer, estimate or fill/i);
  assert.deepEqual(gapsOf(TIRUMALA), ["native", "patron", "origin"]);
});

test("siteDetail never carries a phone — contact details go through the gated tool", () => {
  const result = executeTool("siteDetail", { id: "venkateswara-tirumala" }, CORPUS).result as Record<string, unknown>;
  assert.equal("phone" in result, false);
});

test("brief and full both carry the record's sources", () => {
  assert.deepEqual(brief(KASHI).sources, KASHI.sources);
  assert.deepEqual(full(KASHI).sources, KASHI.sources);
});

// ---------------------------------------------------------------------------
// nearbySites
// ---------------------------------------------------------------------------

test("nearbySites excludes its anchor and reports straight-line distance", () => {
  const outcome = executeTool("nearbySites", { id: "baidyanath-deoghar", radiusKm: 500 }, CORPUS);
  const result = outcome.result as { count: number; records: { id: string; km: number }[]; note: string };
  assert.ok(!result.records.some((r) => r.id === "baidyanath-deoghar"));
  assert.match(result.note, /straight-line/i);
});

test("nearbySites says the atlas is empty there rather than widening the radius", () => {
  const outcome = executeTool("nearbySites", { id: "somnath", radiusKm: 10 }, CORPUS);
  const result = outcome.result as { count: number; note: string };
  assert.equal(result.count, 0);
  assert.match(result.note, /no other sourced site within 10 km/i);
  assert.deepEqual(outcome.cited, []);
});

test("nearbySites without an anchor or coordinates asks for them instead of guessing", () => {
  const result = executeTool("nearbySites", {}, CORPUS).result as { count: number; note: string };
  assert.equal(result.count, 0);
  assert.match(result.note, /needs either a site id or both lat and lng/i);
});

// ---------------------------------------------------------------------------
// circuitMembers — contested claims (G10)
// ---------------------------------------------------------------------------

test("circuitMembers marks a disputed member as contested and carries the dispute", () => {
  const outcome = executeTool("circuitMembers", { circuit: "Jyotirlinga" }, CORPUS);
  const result = outcome.result as {
    count: number; contestedCount: number; note: string;
    members: { id: string; contested: boolean; disputeStatus?: string; disputeNote?: string; disputeSource?: string }[];
  };

  const baidyanath = result.members.find((m) => m.id === "baidyanath-deoghar")!;
  assert.equal(baidyanath.contested, true, "a contested claim must be reported as contested");
  assert.equal(baidyanath.disputeStatus, "disputed");
  assert.match(baidyanath.disputeNote!, /both claim/i);
  assert.equal(baidyanath.disputeSource, "https://en.wikipedia.org/wiki/Vaidyanath_Temple,_Deoghar");

  const somnath = result.members.find((m) => m.id === "somnath")!;
  assert.equal(somnath.contested, false, "an uncontested member is not tarred by its neighbour");

  assert.equal(result.contestedCount, 1);
  assert.equal(result.note, CONTESTED_NOTE);
  assert.match(result.note, /never present a contested claim as the canonical one/i);
});

test("a contested member is listed alongside the others, never ranked above or dropped", () => {
  const result = executeTool("circuitMembers", { circuit: "Jyotirlinga" }, CORPUS).result as
    { members: { id: string }[]; count: number };
  const ids = result.members.map((m) => m.id);
  assert.ok(ids.includes("baidyanath-deoghar"), "dropping a contested claim would hide the disagreement");
  assert.ok(ids.includes("kashi-vishwanath"));
  assert.equal(result.count, 3);
});

test("a contested member is never the one the limit cuts off", () => {
  // Baidyanath sits last in this corpus, so a limit of 1 would drop it — and
  // with it the only sign that the Jyotirlinga slot is disputed at all.
  const result = executeTool("circuitMembers", { circuit: "Jyotirlinga", limit: 1 }, CORPUS).result as
    { members: { id: string; contested: boolean }[]; count: number; contestedCount: number };
  assert.equal(result.count, 3);
  assert.equal(result.contestedCount, 1);
  assert.ok(result.members.some((m) => m.id === "baidyanath-deoghar" && m.contested));
  assert.equal(result.members[0].contested, false, "and it is appended, not promoted above the rest");
});

test("an uncontested circuit carries no contested note at all", () => {
  const corpus = [SOMNATH, KASHI];
  const result = executeTool("circuitMembers", { circuit: "Jyotirlinga" }, corpus).result as
    { contestedCount: number; note?: string };
  assert.equal(result.contestedCount, 0);
  assert.equal(result.note, undefined);
});

test("an unknown circuit returns nothing and says so", () => {
  const result = executeTool("circuitMembers", { circuit: "Seven Wonders" }, CORPUS).result as
    { count: number; note: string };
  assert.equal(result.count, 0);
  assert.equal(result.note, NO_MATCH_NOTE);
});

test("every cited record any tool returns carries a non-empty sources array", () => {
  const calls: [string, Record<string, unknown>][] = [
    ["findSites", { query: "Temple" }],
    ["siteDetail", { id: "venkateswara-tirumala" }],
    ["contactInfo", { id: "kashi-vishwanath" }],
    ["nearbySites", { id: "baidyanath-deoghar", radiusKm: 2000 }],
    ["circuitMembers", { circuit: "Jyotirlinga" }],
  ];
  for (const [name, args] of calls) {
    for (const record of executeTool(name, args, CORPUS).cited) {
      assert.ok(record.sources.length > 0, `${name} cited ${record.id} with no source`);
    }
  }
});
