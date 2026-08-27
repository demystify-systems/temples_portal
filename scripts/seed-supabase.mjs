// Seeds data/sites.json into Supabase. The repo JSON stays canonical; the
// database mirrors it (CLAUDE.md rule 6), so this is always safe to re-run.
//
//   npm run db:seed              # upsert every record
//   npm run db:seed -- --dry-run # build and validate the payload, write nothing
//
// Reads env from the process; `set -a; . ./.env.local; set +a` covers local use.
import { readFileSync } from "node:fs";

const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.argv.includes("--dry-run");

if (!URL_ || !KEY) {
  console.log("Supabase env vars not set — nothing to do (v1 is static-only). See .env.example.");
  process.exit(0);
}

// PostgREST rejects very large single payloads; 941 rows is fine today but the
// corpus is heading for tens of thousands.
const CHUNK_SIZE = 500;

const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));

/** A record with no explicit tier is a full flagship entry — the JSON only marks the leaner ones. */
const tierOf = (s) => s.tier ?? "flagship";

const rows = sites.map((s) => ({
  id: s.id, name: s.name, alt: s.alt ?? null, native: s.native ?? null,
  country: s.country, state: s.state ?? null, place: s.place, lat: s.lat, lng: s.lng,
  tradition: s.tradition, deity: s.deity, built_from: s.built[0], built_to: s.built[1],
  built_display: s.builtDisplay, origin: s.origin ?? null, origin_note: s.originNote ?? null,
  dynasty: s.dynasty, patron: s.patron ?? null, style: s.style, tier: tierOf(s),
  circuits: s.circuits ?? [], status: s.status ?? [],
  significance: s.significance,
  story: s.story ?? null,          // 250 compact records legitimately carry no katha
  access: s.access ?? null,
  website: s.website ?? null, phone: s.phone ?? null, wiki: s.wiki ?? null,
  sources: s.sources, coord_verification: s.verified ?? "curated",
}));

// Fail before writing rather than half way through: these mirror the table's
// check constraints, so a violation is caught locally with a useful message.
const problems = [];
for (const r of rows) {
  if (!Array.isArray(r.sources) || r.sources.length === 0) problems.push(`${r.id}: no sources`);
  if (r.story !== null && r.story === r.significance) problems.push(`${r.id}: story duplicates significance`);
  if (r.phone && !r.website) problems.push(`${r.id}: phone without an official website`);
  if (r.built_from > r.built_to) problems.push(`${r.id}: inverted built range`);
  if (!["stub", "compact", "flagship"].includes(r.tier)) problems.push(`${r.id}: unknown tier "${r.tier}"`);
}
if (problems.length) {
  console.error(`✗ refusing to seed — ${problems.length} record(s) would violate a constraint:`);
  for (const p of problems.slice(0, 20)) console.error("  -", p);
  if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`);
  process.exit(1);
}

const tiers = rows.reduce((acc, r) => ({ ...acc, [r.tier]: (acc[r.tier] ?? 0) + 1 }), {});
console.log(`payload: ${rows.length} rows · tiers ${JSON.stringify(tiers)}`);

if (DRY) {
  console.log("✓ dry run — payload valid, nothing written");
  process.exit(0);
}

let written = 0;
for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
  const chunk = rows.slice(i, i + CHUNK_SIZE);
  const res = await fetch(`${URL_}/rest/v1/sites?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(chunk),
  });
  if (!res.ok) {
    console.error(`seed failed at row ${i}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  written += chunk.length;
  console.log(`  … ${written}/${rows.length}`);
}

console.log(`✓ seeded ${written} sites into Supabase`);
