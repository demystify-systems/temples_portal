// Build the two artefacts the atlas page needs that are NOT JavaScript.
//
//   node scripts/build-map-artefacts.mjs           # write them
//   node scripts/build-map-artefacts.mjs --check   # exit 1 if stale
//
// READ-ONLY on the corpus (constitution rules 2 and 5). This only projects it.
//
// 1. public/r/<id>.json — one file per record, holding exactly the fields the
//    detail rail renders and the map index deliberately omits: the prose, the
//    sources, the practical detail. The rail shows ONE record at a time, so
//    these are fetched on selection instead of bundled for all 3,031. Each is
//    roughly 1-2 kB, served straight from the CDN, and immutable per deploy.
//
//    Why files rather than a database query: the atlas is statically generated
//    and must keep working with no database at all (rule 6). A JSON file next
//    to the HTML has no cold start, no key, no rate limit and no outage.
//
// 2. src/lib/generated/atlas-stats.ts — the header and index-panel counts,
//    computed at BUILD time from the corpus. `headerStats()` in lib/sites.ts
//    computes the same numbers by importing all 3,031 records, which is fine on
//    a server component and catastrophic in a client one: it was a second route
//    by which the whole corpus reached the browser. Precomputing them makes the
//    figures free AND keeps them honest — they are never hardcoded, they are
//    regenerated from the corpus on every build (CLAUDE.md rule: no hardcoded
//    coverage statistic).

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = path.join(ROOT, "data", "sites.json");
const OUT_RECORDS = path.join(ROOT, "public", "r");
const OUT_STATS = path.join(ROOT, "src", "lib", "generated", "atlas-stats.ts");
const GEO = path.join(ROOT, "data", "geo.json");
const OUT_PROJECTION = path.join(ROOT, "src", "lib", "generated", "map-projection.ts");
const SW_SRC = path.join(ROOT, "public", "sw.js");

/**
 * Fields the detail rail renders that the map index does not carry.
 *
 * `deity`, `style` and `native` ARE in the search index (the gazetteer facets on
 * deity), so they are not repeated here — the rail reads them from the record it
 * already has. Everything below is prose or practical detail that exists for
 * exactly one purpose: being read on the selected record's panel.
 */
const DETAIL_FIELDS = [
  "significance", "story", "access", "website", "phone", "wiki",
  "patron", "origin", "originNote", "status", "sources", "verified",
];

const detailOf = (site) => {
  const out = {};
  for (const field of DETAIL_FIELDS) {
    const value = site[field];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[field] = value;
  }
  return out;
};

/** UNESCO is claimed via `status` or via a circuit name; the stat counts either. */
const isUnesco = (s) =>
  (s.status ?? []).includes("UNESCO") || (s.circuits ?? []).some((c) => c.includes("UNESCO"));

const statsOf = (sites) => ({
  sites: sites.length,
  countries: new Set(sites.map((s) => s.country)).size,
  traditions: new Set(sites.map((s) => s.tradition)).size,
  centuries: Math.round((2030 - Math.min(...sites.map((s) => s.built?.[0] ?? 2030))) / 100),
  unesco: sites.filter(isUnesco).length,
});

/**
 * The map's projection box — six numbers, and NOT the geometry.
 *
 * data/geo.json is 376 kB raw / 136.7 kB gzipped, and 385 kB of that is
 * `svgInner`: the country outlines. AtlasClient imported the whole file to read
 * six numbers off it and to inject the outlines, so 136.7 kB of static SVG
 * markup shipped as JavaScript on every homepage load.
 *
 * The outlines are MARKUP, not data. They never change between deploys and
 * nothing interactive reads them, so `page.tsx` — a server component — renders
 * them straight into the HTML and the client never downloads them as a module.
 * What the client genuinely needs is this: the extent it projects into.
 */
const renderProjection = (geo) => `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Written by scripts/build-map-artefacts.mjs from data/geo.json.
//
// The projection box only. The country outlines (\`svgInner\`, 385 kB) are
// server-rendered by src/app/page.tsx and must never be imported by a client
// component — that is 136.7 kB gzipped of static markup shipped as JavaScript.

/** The map's own coordinate box, in the India-worldview projection (rule 1). */
export const MAP_BOX = {
  W: ${geo.W}, H: ${geo.H},
  LON0: ${geo.LON0}, LON1: ${geo.LON1},
  LAT0: ${geo.LAT0}, LAT1: ${geo.LAT1},
} as const;
`;

const renderStats = (stats) => `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Written by scripts/build-map-artefacts.mjs from data/sites.json.
// Regenerate with:  node scripts/build-map-artefacts.mjs
//
// These are the header and index-panel figures, computed at BUILD time. The
// client component that shows them must never compute them itself: doing so
// means importing all ${stats.sites} records into the browser, which is the bug this
// file exists to close. They are generated, never hardcoded, so they cannot go
// stale against the corpus.

export type AtlasStats = {
  readonly sites: number;
  readonly countries: number;
  readonly traditions: number;
  readonly centuries: number;
  /** Records claiming UNESCO World Heritage status, via \`status\` or a circuit. */
  readonly unesco: number;
};

export const ATLAS_STATS: AtlasStats = ${JSON.stringify(stats, null, 2)};
`;

const main = () => {
  const check = process.argv.includes("--check");
  const sites = JSON.parse(readFileSync(CORPUS, "utf8"));
  if (!Array.isArray(sites) || sites.length === 0) {
    console.error(`build-map-artefacts: ${CORPUS} is not a non-empty array`);
    process.exit(1);
  }

  const geo = JSON.parse(readFileSync(GEO, "utf8"));
  const stats = statsOf(sites);
  const statsSource = renderStats(stats);
  const projectionSource = renderProjection(geo);

  if (check) {
    const onDisk = existsSync(OUT_STATS) ? readFileSync(OUT_STATS, "utf8") : null;
    const onDiskProj = existsSync(OUT_PROJECTION) ? readFileSync(OUT_PROJECTION, "utf8") : null;
    const count = existsSync(OUT_RECORDS) ? readdirSync(OUT_RECORDS).length : 0;
    if (onDisk === statsSource && onDiskProj === projectionSource && count === sites.length) {
      console.log(`build-map-artefacts: up to date (${sites.length} records)`);
      return;
    }
    console.error(
      "build-map-artefacts: generated artefacts are stale or missing.\n" +
      "  Run: node scripts/build-map-artefacts.mjs",
    );
    process.exit(1);
  }

  // Rebuilt from scratch so a record deleted from the corpus cannot leave a
  // stale detail file behind, still fetchable, still citing itself.
  rmSync(OUT_RECORDS, { recursive: true, force: true });
  mkdirSync(OUT_RECORDS, { recursive: true });
  let bytes = 0;
  for (const site of sites) {
    const json = JSON.stringify(detailOf(site));
    bytes += json.length;
    writeFileSync(path.join(OUT_RECORDS, `${site.id}.json`), json);
  }

  mkdirSync(path.dirname(OUT_STATS), { recursive: true });
  writeFileSync(OUT_STATS, statsSource);
  writeFileSync(OUT_PROJECTION, projectionSource);

  // Stamp the service worker's cache version.
  //
  // Derived from the corpus itself — record count plus a hash of every id — so
  // it changes exactly when the cached content changes, and does NOT change on
  // a rebuild that altered nothing. A timestamp would invalidate every visitor's
  // cache on every deploy, including deploys that touched no data.
  if (existsSync(SW_SRC)) {
    const fingerprint = createHash("sha256")
      .update(String(sites.length))
      .update(sites.map((s) => s.id).join("\u0000"))
      .digest("hex")
      .slice(0, 12);
    const sw = readFileSync(SW_SRC, "utf8");
    const stamped = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${fingerprint}";`);
    if (stamped !== sw) writeFileSync(SW_SRC, stamped);
    console.log(`  service worker    cache version ${fingerprint}`);
  }

  console.log(`build-map-artefacts: ${sites.length} records -> public/r/*.json`);
  console.log(`  detail payload   ${(bytes / 1024 / 1024).toFixed(2)} MB total, ${Math.round(bytes / sites.length)} bytes average per record`);
  console.log(`  stats            ${JSON.stringify(stats)}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
