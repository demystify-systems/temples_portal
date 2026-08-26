// Weekly coordinate-drift check against Wikidata (CC0).
// For each site with an English Wikipedia URL, resolve its Wikidata item by
// enwiki title and compare P625 coordinates. Reports drift > ~2 km.
// DETECT ONLY — never auto-edits data (a human reviews the report/issue).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));
const UA = "TirthaAtlas/0.1 (temples_portal; data verification bot)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const titleOf = (wiki) => decodeURIComponent(wiki.split("/wiki/")[1] ?? "");
const km = (a, b, c, d) => {
  const R = 6371, dLat = ((c - a) * Math.PI) / 180, dLon = ((d - b) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const withWiki = sites.filter((s) => s.wiki?.includes("/wiki/"));
const report = { checked: 0, drifted: [], missing: [], errors: [] };

for (const batch of chunk(withWiki, 40)) {
  const titles = batch.map((s) => titleOf(s.wiki)).join("|");
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(titles)}&props=claims|sitelinks&format=json&origin=*`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const data = await res.json();
    const byTitle = new Map();
    for (const ent of Object.values(data.entities ?? {})) {
      const t = ent.sitelinks?.enwiki?.title;
      if (t) byTitle.set(t.replaceAll(" ", "_"), ent);
    }
    for (const s of batch) {
      report.checked++;
      const ent = byTitle.get(titleOf(s.wiki));
      const coord = ent?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (!coord) { report.missing.push(s.id); continue; }
      const d = km(s.lat, s.lng, coord.latitude, coord.longitude);
      if (d > 2) report.drifted.push({ id: s.id, ours: [s.lat, s.lng], wikidata: [+coord.latitude.toFixed(4), +coord.longitude.toFixed(4)], km: +d.toFixed(2) });
    }
  } catch (e) {
    report.errors.push(String(e));
  }
  await sleep(1200); // polite
}

mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
writeFileSync(new URL("../reports/wikidata-drift.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(`checked ${report.checked}/${withWiki.length} · drifted>2km: ${report.drifted.length} · no wikidata coord: ${report.missing.length}`);
if (report.drifted.length) { console.log(JSON.stringify(report.drifted, null, 2)); process.exitCode = 78; } // neutral signal for workflow

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
