// Data gate: the build fails if any record is malformed or UNSOURCED.
// Policy: no source → no field → no publish. (source-cited-catalog discipline)
import { readFileSync } from "node:fs";

const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));
const geo = JSON.parse(readFileSync(new URL("../data/geo.json", import.meta.url)));

const REQUIRED = ["id", "name", "country", "place", "lat", "lng", "tradition", "deity", "built", "builtDisplay", "dynasty", "style", "significance", "sources"]; // story is optional for compact-tier records
const TRADITIONS = new Set(["Hindu", "Buddhist", "Jain", "Sikh"]);
const errors = [];
const ids = new Set();

for (const s of sites) {
  const tag = s.id ?? "<no id>";
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
}

if (errors.length) {
  console.error(`✗ data validation FAILED — ${errors.length} problem(s):`);
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(`✓ data valid: ${sites.length} sites, ${new Set(sites.map((s) => s.country)).size} countries, all records sourced.`);
