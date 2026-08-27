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
import { readFileSync } from "node:fs";

const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));
const geo = JSON.parse(readFileSync(new URL("../data/geo.json", import.meta.url)));
const { exceptions } = JSON.parse(readFileSync(new URL("../data/vocab/gate-exceptions.json", import.meta.url)));

const STRICT = process.argv.includes("--strict");
const VERBOSE = process.argv.includes("--verbose");

const REQUIRED = ["id", "name", "country", "place", "lat", "lng", "tradition", "deity", "built", "builtDisplay", "dynasty", "style", "significance", "sources"]; // story is optional for compact-tier records
const TRADITIONS = new Set(["Hindu", "Buddhist", "Jain", "Sikh"]);
const TIERS = new Set(["stub", "compact", "flagship"]);

// Circuits with a canonically fixed membership. A count that disagrees is a
// correctness bug, not incompleteness: filtering to "Jyotirlinga" and being handed
// 14 tells any reader who knows the tradition that we do not.
const FIXED_CIRCUITS = {
  Jyotirlinga: 12, "Char Dham": 4, "Chota Char Dham": 4, "Panch Kedar": 5,
  "Panch Prayag": 5, "Pancha Bhoota Sthalam": 5, Ashtavinayak: 8,
  "Arupadai Veedu": 6, "Sapta Puri": 7, "Sapta Badri": 7, "Divya Desam": 108,
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
  for (const k of REQUIRED) if (!(k in s)) errors.push(`${tag}: missing required field "${k}"`);
  if (ids.has(s.id)) errors.push(`duplicate id: ${s.id}`);
  ids.add(s.id);
  if (!TRADITIONS.has(s.tradition)) errors.push(`${tag}: unknown tradition "${s.tradition}"`);
  if (!(s.lat > geo.LAT0 && s.lat < geo.LAT1 && s.lng > geo.LON0 && s.lng < geo.LON1))
    errors.push(`${tag}: coordinates ${s.lat},${s.lng} outside map bounds`);
  if (!Array.isArray(s.built) || s.built.length !== 2 || s.built[0] > s.built[1])
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
const circuitCounts = {};
for (const s of sites) for (const c of s.circuits ?? []) circuitCounts[c] = (circuitCounts[c] ?? 0) + 1;
for (const [circuit, expected] of Object.entries(FIXED_CIRCUITS)) {
  const actual = circuitCounts[circuit];
  if (actual === undefined) continue;
  if (actual > expected) warnings.push(`[circuit-overfull] ${circuit}: ${actual} tagged for a canonical ${expected} — mark disputed claimants`);
  else if (actual < expected) warnings.push(`[circuit-incomplete] ${circuit}: ${actual}/${expected}`);
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
