// Applies data/vocab/*.json to the corpus and reports what it cannot resolve.
//
//   node scripts/normalize-vocab.mjs            # report only (default)
//   node scripts/normalize-vocab.mjs --json     # machine-readable summary
//
// This script NEVER writes data/sites.json. Lexical variants it can collapse are
// reported as safe; anything that needs a fact decided (a compound value like
// "Pallava, then Chola under Rajendra Chola I", which conflates dynasty with a
// construction sequence) goes to a review queue for a human — guardrail G9.
//
// scripts/merge-batches.mjs should call resolve() on incoming records so new
// batches land normalised. Sweeping afterwards costs 10x: one wave of 253
// records added 99 previously-unseen dynasty values.

import { readFileSync } from "node:fs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const sites = load("../data/sites.json");
const dynastyVocab = load("../data/vocab/dynasty.json");
const styleVocab = load("../data/vocab/style.json");

/** Flatten {canonical: {aliases, qualified}} into one lookup: variant -> {canonical, note}. */
export function buildIndex(vocab) {
  const index = new Map();
  for (const [canonical, def] of Object.entries(vocab.canonical)) {
    index.set(canonical, { canonical, note: null });
    for (const alias of def.aliases ?? []) index.set(alias, { canonical, note: null });
    for (const [alias, note] of Object.entries(def.qualified ?? {})) {
      index.set(alias, { canonical, note });
    }
  }
  return index;
}

/** Resolve one raw value. Returns null when only a human can decide. */
export function resolve(index, raw) {
  if (raw == null) return null;
  const direct = index.get(raw) ?? index.get(String(raw).trim());
  return direct ?? null;
}

// A value carrying any of these is prose, not a label: it encodes a sequence,
// a patron, or an attribution that normalisation must not silently discard.
const COMPOUND = /[;,]|\bthen\b|\bwith\b|\blater\b|\bunder\b|\bearlier\b|\band\b|\/|\bpatronage\b|\bfounded\b|\bbuilt\b|\battributed\b|\breign\b/i;

const index = buildIndex(dynastyVocab);

const counts = new Map();
for (const s of sites) counts.set(s.dynasty, (counts.get(s.dynasty) ?? 0) + 1);

const resolved = [];
const compound = [];
const unknown = [];

for (const [raw, n] of counts) {
  const hit = resolve(index, raw);
  if (hit) resolved.push({ raw, n, ...hit });
  else if (COMPOUND.test(raw)) compound.push({ raw, n });
  else unknown.push({ raw, n });
}

const recordsFor = (rows) => rows.reduce((a, r) => a + r.n, 0);
const canonicalLabels = new Set(resolved.map((r) => r.canonical));

const summary = {
  records: sites.length,
  raw_values: counts.size,
  canonical_labels_defined: Object.keys(dynastyVocab.canonical).length,
  resolved: { values: resolved.length, records: recordsFor(resolved), canonical_labels: canonicalLabels.size },
  needs_review: {
    compound: { values: compound.length, records: recordsFor(compound) },
    unknown: { values: unknown.length, records: recordsFor(unknown) },
  },
};

// ---------------------------------------------------------------- style
// Style differs from dynasty: its variants are overwhelmingly `Canonical
// (qualifier)` or `A–B fusion`, so the qualifier can be split into a note
// mechanically instead of minting a new label for every single record.
const styleIndex = new Map();
for (const [canonical, def] of Object.entries(styleVocab.canonical)) {
  styleIndex.set(canonical.toLowerCase(), canonical);
  for (const alias of def.aliases ?? []) styleIndex.set(alias.toLowerCase(), canonical);
}
const UNSET = new Set(styleVocab.unset.map((v) => v.toLowerCase()));

/** Returns {canonical, note} | {unset:true} | null when a human must decide. */
export function resolveStyle(raw) {
  const value = String(raw ?? "").trim();
  if (UNSET.has(value.toLowerCase())) return { unset: true };

  const direct = styleIndex.get(value.toLowerCase());
  if (direct) return { canonical: direct, note: null };

  // "Nagara (white granite)" -> Nagara + "white granite"
  const paren = value.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (paren) {
    const head = styleIndex.get(paren[1].trim().toLowerCase());
    if (head) return { canonical: head, note: paren[2].trim() };
  }

  // "Kalinga–Dravida fusion" -> Kalinga + "with Dravida"
  const fusion = value.match(/^([^–—-]+?)\s*[–—-]\s*([^–—-]+?)(?:\s+fusion)?$/i);
  if (fusion) {
    const head = styleIndex.get(fusion[1].trim().toLowerCase());
    const other = styleIndex.get(fusion[2].trim().toLowerCase());
    if (head && other) return { canonical: head, note: `with ${other}` };
  }

  // "Modern Nagara" / "Modern Dravida" -> the style, qualified as modern
  const prefixed = value.match(/^(Modern|Early|Late)\s+(.+)$/i);
  if (prefixed) {
    const head = styleIndex.get(prefixed[2].trim().toLowerCase());
    if (head) return { canonical: head, note: prefixed[1].toLowerCase() };
  }

  return null;
}

const styleCounts = new Map();
for (const s of sites) styleCounts.set(s.style, (styleCounts.get(s.style) ?? 0) + 1);

const styleResolved = [];
const styleUnset = [];
const styleReview = [];
for (const [raw, n] of styleCounts) {
  const hit = resolveStyle(raw);
  if (hit?.unset) styleUnset.push({ raw, n });
  else if (hit) styleResolved.push({ raw, n, ...hit });
  else styleReview.push({ raw, n });
}
const styleLabels = new Set(styleResolved.map((r) => r.canonical));

summary.style = {
  raw_values: styleCounts.size,
  canonical_labels_defined: Object.keys(styleVocab.canonical).length,
  resolved: { values: styleResolved.length, records: recordsFor(styleResolved), canonical_labels: styleLabels.size },
  unset: { values: styleUnset.length, records: recordsFor(styleUnset) },
  needs_review: { values: styleReview.length, records: recordsFor(styleReview) },
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, compound, unknown, styleReview }, null, 2));
  process.exit(0);
}

const pct = (n) => `${Math.round((100 * n) / sites.length)}%`;
console.log("=== dynasty vocabulary ===");
console.log(`  ${summary.records} records · ${summary.raw_values} raw values · ${summary.canonical_labels_defined} canonical labels defined`);
console.log(`  resolved     : ${summary.resolved.records} records (${pct(summary.resolved.records)}) across ${summary.resolved.values} variants -> ${summary.resolved.canonical_labels} labels`);
console.log(`  compound     : ${summary.needs_review.compound.records} records (${pct(summary.needs_review.compound.records)}) — prose, needs a human (G9)`);
console.log(`  unknown      : ${summary.needs_review.unknown.records} records (${pct(summary.needs_review.unknown.records)}) — add to the map or review`);

if (unknown.length) {
  console.log("\n--- unknown, add to data/vocab/dynasty.json ---");
  for (const u of unknown.sort((a, b) => b.n - a.n).slice(0, 40)) console.log(`  ${u.n}\t${u.raw}`);
}
if (compound.length) {
  console.log(`\n--- compound (first 15 of ${compound.length}); these conflate dynasty with patron or phase ---`);
  for (const c of compound.slice(0, 15)) console.log(`  ${c.n}\t${c.raw}`);
}

console.log("\n=== style vocabulary ===");
console.log(`  ${summary.style.raw_values} raw values · ${summary.style.canonical_labels_defined} canonical labels defined`);
console.log(`  resolved     : ${summary.style.resolved.records} records (${pct(summary.style.resolved.records)}) across ${summary.style.resolved.values} variants -> ${summary.style.resolved.canonical_labels} labels`);
console.log(`  unset ('—')  : ${summary.style.unset.records} records (${pct(summary.style.unset.records)}) — no style recorded at all`);
console.log(`  needs review : ${summary.style.needs_review.records} records (${pct(summary.style.needs_review.records)})`);
if (styleReview.length) {
  console.log(`\n--- style, needs review (first 20 of ${styleReview.length}) ---`);
  for (const s of styleReview.sort((a, b) => b.n - a.n).slice(0, 20)) console.log(`  ${s.n}\t${s.raw}`);
}
