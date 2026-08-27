// Coordinate precision review queue (BACKLOG C1). DETECT ONLY — writes no data.
//
//   node scripts/report-coordinates.mjs                # offline: list the imprecise records
//   node scripts/report-coordinates.mjs --fetch        # also look up Wikidata P625 candidates
//   node scripts/report-coordinates.mjs --fetch --write
//
// Why this is not an auto-fix: CLAUDE.md rule 5 and guardrail G9. Wikidata P625
// is CC0 and usually better, but not always — some entries point at a village
// centroid too. A human accepts each change and records the citation.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));
const FETCH = process.argv.includes("--fetch");
const UA = "TirthaAtlas-coordinate-audit/1.0 (https://tirthaatlas.org; contact via repo)";

const dp = (n) => { const s = String(n); const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };
const KM = [111, 11, 1.1];

const suspect = sites
  .map((s) => ({ s, precision: Math.min(dp(s.lat), dp(s.lng)) }))
  .filter(({ precision }) => precision <= 2)
  .sort((a, b) => a.precision - b.precision);

/** Great-circle distance in km. */
const haversine = (a, b, c, d) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const titleOf = (wiki) => {
  try { return decodeURIComponent(new URL(wiki).pathname.replace("/wiki/", "")).replace(/_/g, " "); }
  catch { return null; }
};

/** wbgetentities accepts up to 50 titles per call — batch, and be polite. */
async function wikidataCoords(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&titles=${
      encodeURIComponent(batch.join("|"))}&props=claims|sitelinks&languages=en&format=json&origin=*`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) { console.error(`  wikidata ${res.status} on batch ${i / 40}`); continue; }
      const json = await res.json();
      for (const [qid, ent] of Object.entries(json.entities ?? {})) {
        if (qid.startsWith("-")) continue;
        const claim = ent.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
        const title = ent.sitelinks?.enwiki?.title;
        if (claim && title) out.set(title, { qid, lat: claim.latitude, lng: claim.longitude });
      }
    } catch (e) { console.error("  wikidata fetch failed:", e.message); }
    await new Promise((r) => setTimeout(r, 400)); // rate-limit courtesy
  }
  return out;
}

let candidates = new Map();
if (FETCH) {
  const titles = [...new Set(suspect.map(({ s }) => titleOf(s.wiki)).filter(Boolean))];
  console.error(`fetching P625 for ${titles.length} titles…`);
  candidates = await wikidataCoords(titles);
  console.error(`  got ${candidates.size} coordinate claims\n`);
}

const lines = [];
const say = (s = "") => { lines.push(s); console.log(s); };

say("# Coordinate precision review queue");
say();
say(`_${suspect.length} of ${sites.length} records carry coordinates at 2 decimal places or fewer._`);
say(`_Detect-only: nothing here is applied automatically (CLAUDE.md rule 5, guardrail G9)._`);
say();
say("2dp is roughly 1.1 km, 1dp roughly 11 km, 0dp roughly 111 km — village-centre precision");
say("or worse, which is visibly wrong on the map at temple zoom.");
say();
if (FETCH) {
  say("`P625` is the Wikidata coordinate claim (CC0, safe to reuse). **Verify each before applying** —");
  say("some Wikidata entries are themselves village centroids. Record the QID as the citation.");
  say();
}

const header = FETCH
  ? "| dp | id | name | ours | Wikidata P625 | Δ km | QID |\n|---:|---|---|---|---|---:|---|"
  : "| dp | id | name | place | ours |\n|---:|---|---|---|---|";
say(header);

let improvable = 0;
for (const { s, precision } of suspect) {
  const ours = `${s.lat},${s.lng}`;
  if (!FETCH) { say(`| ${precision} | \`${s.id}\` | ${s.name} | ${s.place} | ${ours} |`); continue; }
  const cand = candidates.get(titleOf(s.wiki) ?? "");
  if (!cand) { say(`| ${precision} | \`${s.id}\` | ${s.name} | ${ours} | _no P625_ | | |`); continue; }
  const d = haversine(s.lat, s.lng, cand.lat, cand.lng);
  const better = Math.min(dp(cand.lat), dp(cand.lng)) > precision;
  if (better) improvable += 1;
  say(`| ${precision} | \`${s.id}\` | ${s.name} | ${ours} | ${cand.lat.toFixed(5)},${cand.lng.toFixed(5)}${better ? " ✔" : ""} | ${d.toFixed(2)} | [${cand.qid}](https://www.wikidata.org/wiki/${cand.qid}) |`);
}
say();
if (FETCH) say(`**${improvable} of ${suspect.length}** have a strictly more precise Wikidata candidate.`);
say();
say("## How to apply");
say();
say("1. Open the QID, confirm the point actually sits on the temple (not the village).");
say("2. Update `lat`/`lng`, add the Wikidata QID to `sources`, set `verified` to `wikidata-<date>`.");
say("3. Re-run `npm run validate` — the `coord-precision` warning count must fall.");

if (process.argv.includes("--write")) {
  const dir = new URL("../reports", import.meta.url);
  if (!existsSync(dir)) mkdirSync(dir);
  writeFileSync(new URL("../reports/coordinates.md", import.meta.url), lines.join("\n") + "\n");
  console.error("\n→ wrote reports/coordinates.md");
}
