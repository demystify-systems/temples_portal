// Merge agent-built batch records into data/sites.json.
//
//   node scripts/merge-batches.mjs data/batches/records_15.json …   # merge the named files
//   node scripts/merge-batches.mjs --all                            # merge every data/batches/records_*.json
//   node scripts/merge-batches.mjs --all --dry-run                  # report only, write nothing
//
// Policy (CLAUDE.md): no source → no field → no publish. A record that fails any
// structural check is DROPPED with a logged reason — never repaired by guesswork.
//
// Dedupe, per PHASE2.md, with two guards it does not mention:
//   • coordinates identical to 3 dp (~111 m) AND a related name  → same site, dropped
//   • normalised name identical AND within DUP_KM                → same site, dropped
// The guards matter in both directions. A name that repeats far away is a different
// temple, so it is kept and its id auto-suffixed. A coordinate that repeats under an
// unrelated name is usually a distinct shrine sharing a courtyard, so it is also kept
// — and reported for a human to confirm, because silently deleting a real temple is
// the worse failure.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITES_PATH = path.join(ROOT, "data", "sites.json");
const BATCH_DIR = path.join(ROOT, "data", "batches");

const TRADITIONS = new Set(["Hindu", "Buddhist", "Jain", "Sikh"]);
const REQUIRED = ["id", "name", "country", "place", "lat", "lng", "tradition", "deity", "built", "builtDisplay", "dynasty", "significance", "sources"];
const DEFAULT_STYLE = "—";
const DEFAULT_TIER = "compact";
const DUP_KM = 25;
const EARTH_KM = 6371;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const useAll = args.includes("--all");
const explicit = args.filter((a) => !a.startsWith("--"));

const batchFiles = useAll
  ? readdirSync(BATCH_DIR).filter((f) => /^records_\d+\.json$/.test(f)).sort().map((f) => path.join(BATCH_DIR, f))
  : explicit.map((f) => path.resolve(ROOT, f));

if (batchFiles.length === 0) {
  console.error("usage: node scripts/merge-batches.mjs <records_NN.json …> | --all [--dry-run]");
  process.exit(1);
}

const geo = JSON.parse(readFileSync(path.join(ROOT, "data", "geo.json"), "utf8"));

const normName = (v) =>
  String(v ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const coordKey = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

// Words that carry no identity: two temples sharing only these are not the same temple.
const NOISE = new Set(["temple", "temples", "kovil", "koil", "koyil", "mandir", "mandira", "shrine", "swamy", "swami", "sthalam", "sri", "shri", "the", "of", "and", "at"]);
const tokens = (v) => new Set(normName(v).split(" ").filter((w) => w && !NOISE.has(w)));

/**
 * Do two names plausibly denote the same temple?
 *
 * This guards the coordinate rule. Indian temple towns are full of distinct,
 * separately notable shrines sharing one courtyard — the Adi Varaha Divya Desam
 * sits inside the Kamakshi Amman Shakti Peetha, on the same coordinate to 4 dp.
 * Identical coordinates alone must not be allowed to delete one of them.
 */
function nameRelated(a, b) {
  const [x, y] = [normName(a), normName(b)];
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const [ta, tb] = [tokens(a), tokens(b)];
  if (ta.size === 0 || tb.size === 0) return false;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

const distanceKm = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Structural gate. Returns an array of reasons; empty means the record may publish. */
function defects(r) {
  const bad = [];
  if (!r || typeof r !== "object" || Array.isArray(r)) return ["not an object"];
  for (const k of REQUIRED) if (r[k] === undefined || r[k] === null || r[k] === "") bad.push(`missing "${k}"`);
  if (typeof r.lat !== "number" || typeof r.lng !== "number" || Number.isNaN(r.lat) || Number.isNaN(r.lng)) bad.push("lat/lng not numeric");
  else if (!(r.lat > geo.LAT0 && r.lat < geo.LAT1 && r.lng > geo.LON0 && r.lng < geo.LON1)) bad.push(`coordinates ${r.lat},${r.lng} outside map bounds`);
  if (r.tradition && !TRADITIONS.has(r.tradition)) bad.push(`unknown tradition "${r.tradition}"`);
  if (!Array.isArray(r.built) || r.built.length !== 2 || !r.built.every(Number.isInteger) || r.built[0] > r.built[1]) bad.push(`invalid built ${JSON.stringify(r.built)}`);
  if (!Array.isArray(r.sources) || r.sources.length === 0) bad.push("NO SOURCES");
  else for (const s of r.sources) if (!s?.l || !/^https?:\/\/\S+$/.test(s?.u ?? "")) bad.push(`malformed source ${JSON.stringify(s)}`);
  if (r.website && !/^https:\/\//.test(r.website)) bad.push("website is not https");
  if (r.phone && !r.website) bad.push("phone without an official website source");
  if (typeof r.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(r.id ?? "")) bad.push(`id "${r.id}" is not kebab-case ascii`);
  return bad;
}

/** Fill only the two presentational defaults the schema allows; never a fact. */
const withDefaults = (r) => ({ ...r, style: r.style && r.style !== "" ? r.style : DEFAULT_STYLE, tier: r.tier ?? DEFAULT_TIER });

const sites = JSON.parse(readFileSync(SITES_PATH, "utf8"));
const before = sites.length;

const byCoord = new Map(sites.map((s) => [coordKey(s.lat, s.lng), s]));
const byName = new Map();
for (const s of sites) {
  const k = normName(s.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(s);
}
const ids = new Set(sites.map((s) => s.id));

const uniqueId = (base) => {
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
};

const merged = [];
const dropped = { malformed: [], duplicate: [] };
const renamed = [];
const colocated = [];
const perFile = [];

for (const file of batchFiles) {
  const rel = path.relative(ROOT, file);
  let batch;
  try {
    batch = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`✗ ${rel}: unreadable / invalid JSON — ${err.message}`);
    process.exitCode = 1;
    continue;
  }
  if (!Array.isArray(batch)) {
    console.error(`✗ ${rel}: top level is not a JSON array`);
    process.exitCode = 1;
    continue;
  }

  let kept = 0, dupes = 0, bad = 0;
  for (const raw of batch) {
    const problems = defects(raw);
    if (problems.length) {
      dropped.malformed.push({ file: rel, id: raw?.id ?? raw?.name ?? "<unnamed>", problems });
      bad++;
      continue;
    }
    const rec = withDefaults(raw);

    const coordHit = byCoord.get(coordKey(rec.lat, rec.lng));
    if (coordHit && nameRelated(coordHit.name, rec.name)) {
      dropped.duplicate.push({ file: rel, id: rec.id, of: coordHit.id, why: "identical coordinates (3 dp) and a matching name" });
      dupes++;
      continue;
    }
    // Same coordinate, unrelated name: a shrine sharing a courtyard, or a bad
    // coordinate. Keep it — losing a record is the worse error — and say so.
    if (coordHit) colocated.push({ file: rel, id: rec.id, with: coordHit.id, names: `"${rec.name}" / "${coordHit.name}"` });
    const nameHits = byName.get(normName(rec.name)) ?? [];
    const near = nameHits.find((s) => distanceKm(s, rec) <= DUP_KM);
    if (near) {
      dropped.duplicate.push({ file: rel, id: rec.id, of: near.id, why: `same name within ${distanceKm(near, rec).toFixed(1)} km` });
      dupes++;
      continue;
    }

    const id = uniqueId(rec.id);
    if (id !== rec.id) renamed.push({ from: rec.id, to: id });
    const final = { ...rec, id };

    merged.push(final);
    ids.add(id);
    byCoord.set(coordKey(final.lat, final.lng), final);
    const nk = normName(final.name);
    if (!byName.has(nk)) byName.set(nk, []);
    byName.get(nk).push(final);
    kept++;
  }
  perFile.push({ file: rel, input: batch.length, kept, duplicate: dupes, malformed: bad });
}

const out = [...sites, ...merged];

console.log("── merge-batches ──────────────────────────────────────────");
for (const f of perFile) console.log(`  ${f.file.padEnd(32)} in ${String(f.input).padStart(3)} · kept ${String(f.kept).padStart(3)} · dup ${String(f.duplicate).padStart(3)} · malformed ${String(f.malformed).padStart(3)}`);
if (renamed.length) {
  console.log(`\n  id collisions auto-suffixed (${renamed.length}):`);
  for (const r of renamed) console.log(`    ${r.from} → ${r.to}`);
}
if (colocated.length) {
  console.log(`\n  KEPT but sharing a coordinate with an existing site (${colocated.length}) — verify these by hand:`);
  for (const c of colocated) console.log(`    ${c.id} + ${c.with} — ${c.names}`);
}
if (dropped.duplicate.length) {
  console.log(`\n  dropped as duplicates (${dropped.duplicate.length}):`);
  for (const d of dropped.duplicate) console.log(`    ${d.id} ≈ ${d.of} — ${d.why}`);
}
if (dropped.malformed.length) {
  console.log(`\n  dropped as malformed (${dropped.malformed.length}):`);
  for (const d of dropped.malformed) console.log(`    ${d.id} — ${d.problems.join("; ")}`);
}
console.log(`\n  ${before} → ${out.length} sites (+${merged.length})`);

if (dryRun) {
  console.log("  --dry-run: data/sites.json not written");
} else if (merged.length) {
  writeFileSync(SITES_PATH, JSON.stringify(out, null, 1) + "\n");
  console.log(`  wrote ${path.relative(ROOT, SITES_PATH)}`);
} else {
  console.log("  nothing to merge; data/sites.json unchanged");
}
