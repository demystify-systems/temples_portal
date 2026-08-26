// Seeds data/sites.json into Supabase (dormant until env vars are set).
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:seed
import { readFileSync } from "node:fs";

const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.log("Supabase env vars not set — nothing to do (v1 is static-only). See .env.example.");
  process.exit(0);
}
const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));
const rows = sites.map((s) => ({
  id: s.id, name: s.name, alt: s.alt ?? null, native: s.native ?? null,
  country: s.country, state: s.state ?? null, place: s.place, lat: s.lat, lng: s.lng,
  tradition: s.tradition, deity: s.deity, built_from: s.built[0], built_to: s.built[1],
  built_display: s.builtDisplay, origin: s.origin ?? null, origin_note: s.originNote ?? null,
  dynasty: s.dynasty, patron: s.patron ?? null, style: s.style,
  circuits: s.circuits ?? [], status: s.status ?? [],
  significance: s.significance, story: s.story, access: s.access ?? null,
  website: s.website ?? null, phone: s.phone ?? null, wiki: s.wiki ?? null,
  sources: s.sources, coord_verification: s.verified ?? "curated",
}));
const res = await fetch(`${URL_}/rest/v1/sites?on_conflict=id`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify(rows),
});
if (!res.ok) { console.error("seed failed:", res.status, await res.text()); process.exit(1); }
console.log(`✓ seeded ${rows.length} sites into Supabase`);
