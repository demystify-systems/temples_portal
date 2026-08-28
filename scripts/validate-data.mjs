// Data gate: the build fails if any record is malformed or UNSOURCED.
// Policy: no source → no field → no publish. (CLAUDE.md rule 2 / guardrail G2)
//
//   npm run validate                # ERROR rules fail the build; WARN rules report
//   npm run validate -- --verbose   # list every warning
//   npm run validate -- --strict    # WARN rules fail too
//
// Two severities on purpose. ERROR rules are the long-standing invariants and are
// clean today. WARN rules are newly added and have real violations in the corpus:
// they report loudly but do not break the build, so a concurrent batch session is
// never blocked by a rule tightened underneath it. Flip them to --strict in CI
// once the backlog behind each rule is cleared.
import { readFileSync, writeFileSync } from "node:fs";

const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));
const geo = JSON.parse(readFileSync(new URL("../data/geo.json", import.meta.url)));
const { exceptions } = JSON.parse(readFileSync(new URL("../data/vocab/gate-exceptions.json", import.meta.url)));
const { tiers } = JSON.parse(readFileSync(new URL("../data/vocab/tiers.json", import.meta.url)));
const floorsPath = new URL("../data/vocab/coverage-floors.json", import.meta.url);
const floors = JSON.parse(readFileSync(floorsPath));

const STRICT = process.argv.includes("--strict");
const UPDATE_FLOORS = process.argv.includes("--update-floors");
const VERBOSE = process.argv.includes("--verbose");

/**
 * Required fields come from the tier contract, not a flat list.
 *
 * The gate previously demanded the compact set from EVERY record regardless of
 * tier, which quietly made `stub` unreachable: docs/TIERS.md and tiers.json
 * define a stub as name + coordinates + tradition + a source, but the gate
 * rejected anything without deity, dating, dynasty, style and significance. The
 * tier existed on paper and could not be used.
 *
 * That matters now. Roughly 30,000 Wikidata items in the fifteen countries carry
 * CC0 coordinates and no English Wikipedia article, so they can only ever enter
 * as stubs. Reading the contract from tiers.json makes that path real and keeps
 * one definition of what each tier promises instead of two that can drift.
 *
 * Verified before switching: 0 of 2,728 compact and 0 of 68 flagship records
 * fail under the tier-aware rule, so this loosens nothing that was enforced and
 * tightens flagship to what it already meets.
 */
const TIER_REQUIRED = Object.fromEntries(
  Object.entries(tiers).map(([name, def]) => [name, def.requires]),
);
const DEFAULT_TIER = "flagship"; // absent `tier` means a full record, per the corpus convention
const TRADITIONS = new Set(["Hindu", "Buddhist", "Jain", "Sikh"]);
const TIERS = new Set(["stub", "compact", "flagship"]);

// Circuits with a canonically fixed membership. A count that disagrees is a
// correctness bug, not incompleteness: filtering to "Jyotirlinga" and being handed
// 14 tells any reader who knows the tradition that we do not.
const FIXED_CIRCUITS = {
  Jyotirlinga: 12, "Char Dham": 4, "Chota Char Dham": 4, "Panch Kedar": 5,
  "Panch Prayag": 5, "Pancha Bhoota Sthalam": 5, Ashtavinayak: 8,
  "Arupadai Veedu": 6, "Sapta Puri": 7, "Sapta Badri": 7,
  // 108 is the canonical count, but two of them — Tirupparkatal (the Ocean of
  // Milk) and Vaikuntham — are explicitly not of the earthly realm and can never
  // be map records. 106 is the real ceiling for a gazetteer of places.
  "Divya Desam": 106,
};

// Rough per-country boxes. The India box deliberately spans the full India
// point-of-view extent, including PoK and Aksai Chin (CLAUDE.md rule 1).
const COUNTRY_BOX = {
  India: [6.5, 37.6, 68, 97.5], Nepal: [26.3, 30.5, 80, 88.3], "Sri Lanka": [5.8, 10, 79.5, 82],
  Bhutan: [26.6, 28.4, 88.7, 92.2], Cambodia: [10, 14.7, 102, 107.7], Bangladesh: [20.5, 26.7, 88, 92.7],
  Pakistan: [23.6, 37.1, 60.8, 77.9], Myanmar: [9.5, 28.6, 92, 101.2], Thailand: [5.5, 20.5, 97.3, 105.7],
  Indonesia: [-11, 6, 95, 141], Malaysia: [0.8, 7.4, 99.6, 119.3], Laos: [13.9, 22.5, 100, 107.7],
  Vietnam: [8.2, 23.4, 102, 109.5], Afghanistan: [29.4, 38.5, 60.5, 74.9], Singapore: [1.1, 1.5, 103.6, 104.1],
};

const KM_PER_DP = [111, 11, 1.1];

const errors = [];
const warnings = [];
const ids = new Set();
const coordKeys = new Map();

const excused = (id, rule) => (exceptions[id] ?? []).includes(rule);
const warn = (id, rule, msg) => { if (!excused(id, rule)) warnings.push(`[${rule}] ${id}: ${msg}`); };

/** Decimal places actually carried, as a proxy for stated precision. */
const dp = (n) => { const s = String(n); const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };

for (const s of sites) {
  const tag = s.id ?? "<no id>";

  // ---- ERROR: long-standing invariants ------------------------------------
  const tierName = s.tier ?? DEFAULT_TIER;
  const required = TIER_REQUIRED[tierName] ?? TIER_REQUIRED[DEFAULT_TIER];
  for (const k of required) {
    const v = s[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
      errors.push(`${tag}: tier "${tierName}" requires "${k}"`);
    }
  }
  if (ids.has(s.id)) errors.push(`duplicate id: ${s.id}`);
  ids.add(s.id);
  if (!TRADITIONS.has(s.tradition)) errors.push(`${tag}: unknown tradition "${s.tradition}"`);
  if (!(s.lat > geo.LAT0 && s.lat < geo.LAT1 && s.lng > geo.LON0 && s.lng < geo.LON1))
    errors.push(`${tag}: coordinates ${s.lat},${s.lng} outside map bounds`);
  // Shape-check `built` only when the record carries it. A stub has no dating by
  // definition — the tier list above is what decides whether it MUST be present;
  // this decides whether what is present is well formed.
  if (s.built !== undefined && (!Array.isArray(s.built) || s.built.length !== 2 || s.built[0] > s.built[1]))
    errors.push(`${tag}: invalid built range ${JSON.stringify(s.built)}`);
  if (!Array.isArray(s.sources) || s.sources.length === 0)
    errors.push(`${tag}: NO SOURCES — unsourced records cannot be published`);
  for (const src of s.sources ?? []) {
    if (!src.l || !/^https?:\/\/\S+$/.test(src.u ?? "")) errors.push(`${tag}: malformed source ${JSON.stringify(src)}`);
  }
  if (s.phone && !s.website) errors.push(`${tag}: phone present without an official website source`);
  if (s.website && !/^https:\/\//.test(s.website)) errors.push(`${tag}: website must be https`);
  if (s.tier !== undefined && !TIERS.has(s.tier)) errors.push(`${tag}: unknown tier "${s.tier}"`);

  // ---- WARN: newly added; real violations exist today ---------------------

  // Guardrail G3 — documented history and legend must never be the same text.
  if (s.story && s.story === s.significance) warn(tag, "story-eq-significance", "story duplicates significance");

  // Coordinate precision. 2dp is ~1.1 km, 1dp ~11 km — village-centre or worse.
  const precision = Math.min(dp(s.lat), dp(s.lng));
  if (precision <= 2) warn(tag, "coord-precision", `${s.lat},${s.lng} carries only ${precision}dp (~${KM_PER_DP[precision] ?? 111} km)`);

  // Coordinates outside the stated country mean the record is mis-placed or
  // mis-labelled; either way the map lies.
  const box = COUNTRY_BOX[s.country];
  if (box && !(s.lat >= box[0] && s.lat <= box[1] && s.lng >= box[2] && s.lng <= box[3]))
    warn(tag, "country-bbox", `${s.lat},${s.lng} falls outside ${s.country}`);

  // Two records on the same 3dp point (~111 m) are EITHER one site entered twice
  // OR distinct shrines inside one complex — Kanchipuram's Divya Desams sit inside
  // Ulagalantha Perumal, Thirukkalvanur inside Kamakshi Amman. This is a review
  // prompt for a human, never grounds for an automatic merge (G9).
  const key = `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`;
  if (coordKeys.has(key)) warn(tag, "duplicate-coords", `co-located with ${coordKeys.get(key)} at ${key} — same complex, or a duplicate?`);
  else coordKeys.set(key, s.id);

  // Every record cites something, but citing only Wikipedia is thin for a
  // project whose entire pitch is its sourcing.
  if ((s.sources ?? []).length && s.sources.every((x) => /wikipedia\.org/.test(x.u ?? "")))
    warn(tag, "wikipedia-only", "sourced by Wikipedia alone");
}

// ---- WARN: whole-corpus invariants ----------------------------------------
// A record may claim membership AND carry a `disputedCircuits` entry naming that
// same circuit — that is the correct way to hold a contested claim (guardrail
// G10): list it, flag it, cite the dispute. Such records must not count toward
// the canonical total, or marking a claimant as disputed would never clear the
// warning that asked for exactly that.
const circuitCounts = {};
const disputedCounts = {};
for (const s of sites) {
  for (const c of s.circuits ?? []) circuitCounts[c] = (circuitCounts[c] ?? 0) + 1;
  for (const d of s.disputedCircuits ?? []) {
    if ((s.circuits ?? []).includes(d.circuit)) {
      disputedCounts[d.circuit] = (disputedCounts[d.circuit] ?? 0) + 1;
    }
  }
}
// Rival claimants contest a SLOT, and both sides get flagged: Baidyanath Deoghar
// and Vaijnath Parli dispute one Jyotirlinga between them, so 10 uncontested + 2
// contested slots is a complete 12, not a shortfall. The healthy band is
// therefore `undisputed <= expected <= tagged` — only outside it is anything wrong.
for (const [circuit, expected] of Object.entries(FIXED_CIRCUITS)) {
  const tagged = circuitCounts[circuit];
  if (tagged === undefined) continue;
  const disputed = disputedCounts[circuit] ?? 0;
  const undisputed = tagged - disputed;
  const suffix = disputed ? ` (${tagged} tagged, ${disputed} disputed)` : "";

  if (undisputed > expected) {
    warnings.push(`[circuit-overfull] ${circuit}: ${undisputed} uncontested claims for a canonical ${expected}${suffix} — flag the rival claimants`);
  } else if (tagged < expected) {
    warnings.push(`[circuit-incomplete] ${circuit}: ${tagged}/${expected}${suffix}`);
  }
}

// A disputed claim is itself a factual assertion and needs its own citation.
for (const s of sites) {
  for (const d of s.disputedCircuits ?? []) {
    if (!d.circuit) errors.push(`${s.id}: disputedCircuits entry with no circuit`);
    if (!d.note) warn(s.id, "disputed-unexplained", `disputed "${d.circuit}" with no note`);
    if (d.status === "disputed" && !/^https?:\/\/\S+$/.test(d.source ?? ""))
      warn(s.id, "disputed-uncited", `disputed "${d.circuit}" without a source URL`);
  }
}

// ---- ERROR: field coverage must never go backwards -------------------------
//
// A ratchet, not a target. Most fields are held by a small minority of records —
// disputedCircuits by 1%, phone by 2%, access by 3% — and that creates a quiet
// hazard: a test that filters to such a field and asserts a property PASSES on an
// empty set. It stays green while silently testing nothing, right up until the
// day the data disappears, at which point it still passes.
//
// So the guard lives in the data gate rather than in any test. Coverage may rise
// freely; a DROP fails the build. When a decrease is deliberate — the deity tag
// audit that correctly removed 23 wrong tags, taking coverage from 94.1% to
// 93.3% — re-run with --update-floors and commit the new file with the reason.
const COVERAGE_TRACKED = [
  "deities", "deityGroup", "native", "admin", "website", "phone", "access",
  "patron", "story", "circuits", "disputedCircuits", "status", "origin",
  // Provenance. Both sit at 100%, so ANY drop is unambiguous: a wave that forgets
  // to stamp `verified`, or a record that arrives with no source article, is
  // exactly the silent regression this guard exists for.
  "verified", "wiki",
];

/**
 * How far a field's SHARE of the corpus may fall before it is a regression.
 *
 * The absolute count alone has a blind spot, and it is the likelier failure:
 * a wave adds 400 records and nobody re-runs the tag generator. The count holds
 * at 2,802 — no drop, green build — while coverage falls from 93% to 82%.
 * Dilution is invisible to a ratchet that only watches deletion.
 *
 * Two percentage points absorbs ordinary noise (a handful of records arriving
 * before their derived fields) without absorbing a forgotten regeneration.
 */
const COVERAGE_RATIO_TOLERANCE = 0.02;
const held = (s, f) => {
  const v = s[f];
  return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
};
const coverage = Object.fromEntries(COVERAGE_TRACKED.map((f) => {
  const count = sites.filter((s) => held(s, f)).length;
  return [f, { count, ratio: Number((count / sites.length).toFixed(4)) }];
}));

if (UPDATE_FLOORS) {
  writeFileSync(floorsPath, `${JSON.stringify({
    _about: "Coverage ratchet for the data gate. A field's population may rise freely; a DROP fails the build. Regenerate with `npm run validate -- --update-floors` ONLY when a decrease is deliberate, and say why in the commit.",
    _recorded_at: new Date().toISOString().slice(0, 10),
    _records: sites.length,
    floors: coverage,
  }, null, 2)}\n`);
  console.log(`✓ coverage floors updated for ${sites.length} records`);
}

const pct = (r) => `${(r * 100).toFixed(1)}%`;
// After --update-floors the recorded floors ARE the current coverage, so checking
// against the pre-write values would report the exact regression the operator is
// deliberately accepting — and fail the run that was meant to accept it.
const activeFloors = UPDATE_FLOORS ? coverage : (floors.floors ?? {});
for (const [field, floor] of Object.entries(activeFloors)) {
  const now = coverage[field];
  if (!now) continue;

  // Deletion: the field lost records outright.
  if (now.count < floor.count) {
    errors.push(
      `coverage regression: "${field}" is held by ${now.count} records, was ${floor.count}. ` +
      "A field losing records is either a data loss or a generator bug. If the drop is " +
      "deliberate, re-run with --update-floors and record why.",
    );
    continue;
  }

  // Dilution: the count held, but the corpus outgrew it. Almost always a derived
  // field whose generator was not re-run after a data wave.
  if (floor.ratio - now.ratio > COVERAGE_RATIO_TOLERANCE) {
    errors.push(
      `coverage dilution: "${field}" covers ${pct(now.ratio)} of ${sites.length} records, was ` +
      `${pct(floor.ratio)}. The count did not fall (${floor.count} -> ${now.count}), so nothing was ` +
      "deleted — the corpus grew and this field did not keep up. If it is derived, re-run its " +
      "generator; if the new records genuinely cannot carry it, re-run with --update-floors.",
    );
  }
}

// ---------------------------------------------------------------------------
if (warnings.length) {
  const grouped = {};
  for (const w of warnings) {
    const rule = w.match(/^\[([^\]]+)\]/)?.[1] ?? "other";
    grouped[rule] = (grouped[rule] ?? 0) + 1;
  }
  console.warn(`\n⚠ ${warnings.length} warning(s)${STRICT ? " — FAILING (--strict)" : " — not failing the build yet"}:`);
  for (const [rule, n] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
    console.warn(`   ${String(n).padStart(4)}  ${rule}`);
  }
  if (VERBOSE) for (const w of warnings) console.warn("     -", w);
  else console.warn("   (run `npm run validate -- --verbose` for the full list)");
  console.warn("");
}

const fatal = STRICT ? [...errors, ...warnings] : errors;
if (fatal.length) {
  console.error(`✗ data validation FAILED — ${fatal.length} problem(s):`);
  for (const e of fatal.slice(0, 50)) console.error("  -", e);
  if (fatal.length > 50) console.error(`  … and ${fatal.length - 50} more`);
  process.exit(1);
}
console.log(`✓ data valid: ${sites.length} sites, ${new Set(sites.map((s) => s.country)).size} countries, all records sourced.`);
