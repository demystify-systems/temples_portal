// Corpus-leak gate (PERF-A11Y-BUDGET.md section 6, `gate:corpus-leak` + `gate:bundle`).
//
//   node scripts/check-corpus-leak.mjs
//
// Run against a completed `next build`. Two independent checks:
//
//   1. NO RECORD PROSE IN ANY CLIENT CHUNK. The homepage used to inline the
//      whole corpus — 922.1 kB in one chunk — because AtlasClient.tsx imported
//      `SITES`. Prose is the bulk of that and no client page renders more than
//      one record's worth, so a `significance` paragraph appearing in a chunk
//      means the split has regressed. This samples real sentences OUT OF THE
//      CORPUS and greps the chunks for them, rather than looking for field
//      names — a minifier renames identifiers, but it cannot rewrite a string.
//
//   2. WEIGHT BUDGETS, measured as gzip of the real emitted chunks.
//
// Both are reported even when the first fails, so one run tells you everything.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT = path.join(ROOT, ".next");
const MANIFEST = path.join(NEXT, "app-build-manifest.json");

/**
 * Weight budgets, in gzip kB per route.
 *
 * These are RATCHET values, set just above where the build currently sits, not
 * the target. PERF-A11Y-BUDGET.md asks for 200 kB total and a 120 kB largest
 * chunk; the homepage is at 325.2 / 180.0, down from 1,025.7 / 922.1. The
 * remaining gap is the shared search-index chunk, and closing it means fetching
 * that index as JSON instead of bundling it as a module — a further change, not
 * a tightening of this number.
 *
 * Ratcheting rather than aspiring is deliberate: a gate set to a number the
 * build does not meet is a gate that is always red, and an always-red gate is
 * ignored. Lower these as the work lands; never raise them.
 */
const TOTAL_JS_KB = 340;
const LARGEST_CHUNK_KB = 200;
/** Where PERF-A11Y-BUDGET.md wants these to end up. Reported, not enforced yet. */
const TARGET_TOTAL_JS_KB = 200;
const TARGET_LARGEST_CHUNK_KB = 120;

/** Fields no list page or map renders for more than one record at a time. */
const PROSE_FIELDS = ["significance", "story", "access"];
/** How many records to sample sentences from. Enough to catch a partial leak. */
const SAMPLE = 40;

if (!existsSync(MANIFEST)) {
  console.error("check-corpus-leak: no .next/app-build-manifest.json — run `next build` first.");
  process.exit(1);
}

const sites = JSON.parse(readFileSync(path.join(ROOT, "data", "sites.json"), "utf8"));
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

/**
 * Chunks on a route's CRITICAL PATH — the ones a visitor downloads before the
 * page is interactive, listed per route in app-build-manifest.json.
 *
 * The distinction matters and is the whole subtlety of this gate. There IS a
 * chunk full of record prose: the deferred `significance` column, 284.8 kB,
 * dynamically imported by `loadSignificance()` the first time somebody types in
 * the search box. That is a deliberate, measured trade documented in
 * scripts/build-search-index.mjs — full-text search recall costs those bytes,
 * and nobody who does not search ever pays them.
 *
 * So the rule is not "prose must exist in no chunk". It is:
 *
 *   1. prose must appear in no chunk a visitor loads to see the page, and
 *   2. any chunk that does carry prose must be genuinely unreachable on load.
 *
 * Both are checked below. A regression that puts the corpus back on the
 * homepage fails (1); a regression that makes the deferred column eager fails
 * (2), which is exactly how the original bug would come back.
 */
const criticalPath = new Set(Object.values(manifest.pages).flat().filter((f) => f.endsWith(".js")));

const chunkDir = path.join(NEXT, "static", "chunks");
const chunkFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) chunkFiles.push(full);
  }
};
walk(chunkDir);

/** A manifest entry looks like "static/chunks/331-abc.js"; match on that suffix. */
const isCritical = (file) => {
  const rel = path.relative(NEXT, file).split(path.sep).join("/");
  return criticalPath.has(rel);
};

const chunks = chunkFiles.map((file) => ({
  file,
  critical: isCritical(file),
  text: readFileSync(file, "utf8"),
}));

const failures = [];

// ---- 1. prose leak -------------------------------------------------------
//
// A distinctive fragment: long enough to be unique to one record, short enough
// to survive whatever escaping the bundler applies to a string literal. Sampled
// out of the corpus rather than grepping for field NAMES, because a minifier
// renames identifiers but cannot rewrite a string.
const fragmentOf = (text) => {
  const clean = String(text).replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w));
  return words.length >= 6 ? words.slice(2, 8).join(" ") : null;
};

const step = Math.max(1, Math.floor(sites.length / SAMPLE));
const proseChunks = new Set();
let probes = 0;
for (let i = 0; i < sites.length; i += step) {
  for (const field of PROSE_FIELDS) {
    const fragment = fragmentOf(sites[i][field] ?? "");
    if (!fragment) continue;
    probes += 1;
    for (const chunk of chunks) {
      if (!chunk.text.includes(fragment)) continue;
      proseChunks.add(chunk.file);
      if (chunk.critical) {
        failures.push(
          `corpus leak: "${fragment}…" (${sites[i].id}.${field}) is in ` +
          `${path.relative(ROOT, chunk.file)}, which is on a route's CRITICAL PATH. ` +
          `Record prose must never be downloaded to render a page.`,
        );
      }
    }
  }
}

const deferredProse = [...proseChunks].filter((f) => !isCritical(f));

// ---- 2. weight -----------------------------------------------------------
const report = [];
for (const page of ["/page", "/sites/page"]) {
  const files = [...new Set(manifest.pages[page] ?? [])].filter((f) => f.endsWith(".js"));
  if (files.length === 0) continue;
  let total = 0;
  let largest = 0;
  let largestName = "";
  for (const f of files) {
    const kb = gzipSync(readFileSync(path.join(NEXT, f)), { level: 9 }).length / 1024;
    total += kb;
    if (kb > largest) { largest = kb; largestName = path.basename(f); }
  }
  const gapT = total > TARGET_TOTAL_JS_KB ? `  [target ${TARGET_TOTAL_JS_KB}: still ${(total - TARGET_TOTAL_JS_KB).toFixed(0)} kB over]` : "  [meets target]";
  report.push(`  ${page.padEnd(14)} total ${total.toFixed(1).padStart(7)} kB (ratchet ${TOTAL_JS_KB})   largest ${largest.toFixed(1).padStart(7)} kB (ratchet ${LARGEST_CHUNK_KB})  ${largestName}${gapT}`);
  if (total > TOTAL_JS_KB) failures.push(`${page}: ${total.toFixed(1)} kB of JS, over the ${TOTAL_JS_KB} kB budget`);
  if (largest > LARGEST_CHUNK_KB) failures.push(`${page}: largest chunk ${largestName} is ${largest.toFixed(1)} kB, over the ${LARGEST_CHUNK_KB} kB budget`);
}

const criticalCount = chunks.filter((c) => c.critical).length;
console.log(`corpus-leak gate — ${probes} prose probes across ${chunks.length} chunks (${criticalCount} on a critical path)`);
console.log(report.join("\n"));
for (const file of deferredProse) {
  const kb = (gzipSync(readFileSync(file), { level: 9 }).length / 1024).toFixed(1);
  console.log(`  deferred prose ${path.relative(ROOT, file)} (${kb} kB) — lazily imported, on no critical path`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`\n✓ no record prose on any critical path; both routes within the ratchet budget`);
