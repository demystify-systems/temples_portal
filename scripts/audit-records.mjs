// Integrity audit for data/sites.json — the checks `validate-data.mjs` cannot make.
//
//   node scripts/audit-records.mjs               # offline checks only
//   node scripts/audit-records.mjs --net         # also HEAD-check every source URL
//   node scripts/audit-records.mjs --net --since <n>   # only the last n records (new arrivals)
//
// validate-data.mjs is the publish GATE: it proves each record is well formed and
// sourced. This is the SMELL TEST on top: a record can be perfectly well formed and
// still be wrong — the classic failure is a coordinate lifted from a same-named place
// in another state, which is exactly the trap AGENT_INSTRUCTIONS.md warns about.
//
// Nothing here edits data. It reports; a human decides. (CLAUDE.md rule 5.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sites = JSON.parse(readFileSync(path.join(ROOT, "data", "sites.json"), "utf8"));

const args = process.argv.slice(2);
const useNet = args.includes("--net");
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? Number(args[sinceIdx + 1]) : 0;
const scope = since > 0 ? sites.slice(-since) : sites;

const STRAY_KM = 300;        // a site this far from its NEAREST same-region peer is suspect
const TWIN_M = 150;          // two differently-named records this close may be one site
const MIN_SIGNIFICANCE = 60; // characters — shorter than this says nothing
const NET_CONCURRENCY = 3;   // gentle: Wikidata throttles a faster sweep

const EARTH_KM = 6371;
const distanceKm = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const findings = [];
const flag = (level, site, check, detail) => findings.push({ level, id: site.id, check, detail });

// ── 1. regional plausibility ────────────────────────────────────────────────
// Anchor on the NEAREST other site in the same state, not on the state's centroid:
// Varanasi is 580 km from the median of Uttar Pradesh's sites and perfectly correct,
// whereas a record that landed in the wrong state has no near neighbour at all.
// Regions with too few members are skipped rather than guessed at.
const regionOf = (s) => `${s.country}|${s.state ?? ""}`;
const regions = new Map();
for (const s of sites) {
  const k = regionOf(s);
  if (!regions.has(k)) regions.set(k, []);
  regions.get(k).push(s);
}

for (const s of scope) {
  const peers = (regions.get(regionOf(s)) ?? []).filter((o) => o.id !== s.id);
  if (peers.length < 5) continue;
  const d = Math.min(...peers.map((p) => distanceKm(p, s)));
  if (d > STRAY_KM) flag("WARN", s, "stray-coordinate", `nearest of ${peers.length} other ${s.state || s.country} sites is ${d.toFixed(0)} km away — check it is not a same-named place elsewhere`);
}

// ── 2. possible same site under two names ───────────────────────────────────
const sorted = [...sites].sort((a, b) => a.lat - b.lat);
const scopeIds = new Set(scope.map((s) => s.id));
for (let i = 0; i < sorted.length; i++) {
  for (let j = i + 1; j < sorted.length && sorted[j].lat - sorted[i].lat < 0.01; j++) {
    const [a, b] = [sorted[i], sorted[j]];
    if (!scopeIds.has(a.id) && !scopeIds.has(b.id)) continue;
    const m = distanceKm(a, b) * 1000;
    if (m <= TWIN_M) flag("WARN", scopeIds.has(b.id) ? b : a, "possible-twin", `${m.toFixed(0)} m from ${scopeIds.has(b.id) ? a.id : b.id} — same site under two names?`);
  }
}

// ── 3. text and field hygiene ───────────────────────────────────────────────
for (const s of scope) {
  if ((s.significance ?? "").length < MIN_SIGNIFICANCE) flag("WARN", s, "thin-significance", `${(s.significance ?? "").length} chars`);
  if (s.story && s.significance && s.story.trim() === s.significance.trim()) flag("ERROR", s, "katha-equals-history", "story duplicates significance — history and legend must stay separate (CLAUDE.md 3)");
  if (s.built[0] === 1000 && s.built[1] === 1800 && s.builtDisplay !== "dating unrecorded") flag("INFO", s, "sentinel-dates", `built [1000,1800] but builtDisplay is "${s.builtDisplay}"`);
  if (s.origin !== undefined && s.origin > s.built[1]) flag("ERROR", s, "origin-after-structure", `origin ${s.origin} is later than built ${JSON.stringify(s.built)}`);
  if (s.wiki && !/^https:\/\/[a-z]{2,3}\.wikipedia\.org\/wiki\//.test(s.wiki)) flag("WARN", s, "odd-wiki-url", s.wiki);
  const wikiSourced = (s.sources ?? []).some((x) => /wikipedia\.org/.test(x.u));
  if (!wikiSourced && !(s.sources ?? []).length) flag("ERROR", s, "unsourced", "no sources at all");
}

// ── 4. optional: do the cited URLs actually resolve? ────────────────────────
if (useNet) {
  const urls = [...new Set(scope.flatMap((s) => (s.sources ?? []).map((x) => x.u)))];
  const owner = new Map();
  for (const s of scope) for (const x of s.sources ?? []) if (!owner.has(x.u)) owner.set(x.u, s);

  process.stderr.write(`  checking ${urls.length} source URLs…\n`);
  let done = 0;
  // 429 is US being throttled, not the source being gone. Back off and retry
  // rather than reporting a live citation as dead — a false "unreachable" on a
  // good source is worse than a slow audit.
  const check = async (u) => {
    try {
      let res, wait = 1500;
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetch(u, { method: "GET", redirect: "follow", headers: { "user-agent": "tirtha-atlas-source-audit/1 (+https://github.com/demystify-systems/temples_portal)" } });
        if (res.status !== 429 && res.status !== 503) break;
        await new Promise((r) => setTimeout(r, wait));
        wait *= 2;
      }
      if (!res.ok) flag(res.status === 404 ? "ERROR" : "WARN", owner.get(u), "source-unreachable", `${res.status} ${u}`);
    } catch (err) {
      flag("WARN", owner.get(u), "source-unreachable", `${err.name}: ${u}`);
    } finally {
      done++;
      if (done % 50 === 0) process.stderr.write(`    ${done}/${urls.length}\n`);
    }
  };
  const queue = [...urls];
  await Promise.all(Array.from({ length: NET_CONCURRENCY }, async () => {
    while (queue.length) await check(queue.shift());
  }));
}

// ── report ──────────────────────────────────────────────────────────────────
const order = { ERROR: 0, WARN: 1, INFO: 2 };
findings.sort((a, b) => order[a.level] - order[b.level] || a.check.localeCompare(b.check) || a.id.localeCompare(b.id));

const counts = findings.reduce((a, f) => ({ ...a, [f.level]: (a[f.level] ?? 0) + 1 }), {});
console.log(`\naudit-records — ${scope.length} of ${sites.length} records examined${useNet ? " (with network source check)" : ""}`);
console.log(`  ${counts.ERROR ?? 0} error · ${counts.WARN ?? 0} warn · ${counts.INFO ?? 0} info\n`);
for (const f of findings) console.log(`  ${f.level.padEnd(5)} ${f.check.padEnd(22)} ${f.id.padEnd(38)} ${f.detail}`);
if (!findings.length) console.log("  clean.");
console.log("");

process.exit(counts.ERROR ? 1 : 0);
