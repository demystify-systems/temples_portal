// Source tiering (BACKLOG C4). DETECT ONLY.
//   node scripts/report-sources.mjs [--write]
//
// The gate proves a citation EXISTS. It cannot prove the citation SUPPORTS the
// claim, and Wikipedia is weakest on exactly what this project differentiates on:
// dating and dynasty attribution. This ranks what we actually cite.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));

// Strongest first. A record's tier is the strongest source it carries.
const TIERS = [
  { tier: "primary",     rank: 4, why: "inscription corpora, ASI, UNESCO, national archaeology depts",
    test: (h) => /asi\.nic\.in|whc\.unesco\.org|inscriptions\.|epigraphia|apsaraauthority|archaeology\./i.test(h) },
  { tier: "official",    rank: 3, why: "the temple's or board's own site",
    test: (h) => /\.gov\.|\.gov$|\.nic\.in|hrce\.|tirumala\.org|sgpc\.net|devaswom|sabarimala|jagannatha|somnath\.org|shrikashi|maavaishnodevi|siddhivinayak|pashupati/i.test(h) },
  { tier: "scholarly",   rank: 2, why: "academic and institutional research",
    test: (h) => /\.edu|\.ac\.|jstor|aiis|britannica|templesproject/i.test(h) },
  { tier: "encyclopedic",rank: 1, why: "Wikipedia and general reference",
    test: (h) => /wikipedia\.org|wikidata\.org/i.test(h) },
];
const classify = (u) => {
  let host; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch { return null; }
  return (TIERS.find((t) => t.test(host)) ?? { tier: "editorial", rank: 0, why: "tourism, blogs, listings" }).tier;
};
const RANK = Object.fromEntries([...TIERS, { tier: "editorial", rank: 0 }].map((t) => [t.tier, t.rank]));

const rows = sites.map((s) => {
  const tiers = (s.sources ?? []).map((x) => classify(x.u)).filter(Boolean);
  const best = tiers.sort((a, b) => RANK[b] - RANK[a])[0] ?? "none";
  return { s, best, count: tiers.length, wikiOnly: tiers.length > 0 && tiers.every((t) => t === "encyclopedic") };
});

const byTier = {};
for (const r of rows) byTier[r.best] = (byTier[r.best] ?? 0) + 1;
const wikiOnly = rows.filter((r) => r.wikiOnly);
const flagshipWikiOnly = wikiOnly.filter((r) => !r.s.tier);

const lines = []; const say = (s = "") => { lines.push(s); console.log(s); };
say("# Source tiering report");
say();
say(`_${sites.length} records. Detect-only._`);
say();
say("| Strongest source | Records | % | What it means |");
say("|---|---:|---:|---|");
for (const t of [...TIERS, { tier: "editorial", why: "tourism, blogs, listings" }]) {
  const n = byTier[t.tier] ?? 0;
  if (!n) continue;
  say(`| ${t.tier} | ${n} | ${Math.round((100 * n) / sites.length)}% | ${t.why} |`);
}
say();
say(`## The number that matters: ${wikiOnly.length} records (${Math.round((100 * wikiOnly.length) / sites.length)}%) cite Wikipedia and nothing else`);
say();
say("Guardrail G2 is satisfied *formally* — every record has a source. But a single");
say("Wikipedia citation does not support the dating and dynasty attributions this project");
say("differentiates on, and the positioning is \"the temple site that shows its sources\".");
say("A reviewer will call this a Wikipedia mirror with a good map unless it moves.");
say();
say(`Of those, **${flagshipWikiOnly.length}** are flagship-tier records, which should never be single-sourced.`);
say();
say("**Recommended:** make \"at least one non-Wikipedia source\" a hard requirement of the");
say("flagship tier (already declared in `data/vocab/tiers.json`), and state the real figure");
say("on /about. Honest beats impressive.");
say();
if (flagshipWikiOnly.length) {
  say("### Flagship records needing a second source");
  say();
  for (const r of flagshipWikiOnly.slice(0, 40)) say(`- \`${r.s.id}\` — ${r.s.name}`);
  if (flagshipWikiOnly.length > 40) say(`- …and ${flagshipWikiOnly.length - 40} more`);
  say();
}
if (process.argv.includes("--write")) {
  const d = new URL("../reports", import.meta.url); if (!existsSync(d)) mkdirSync(d);
  writeFileSync(new URL("../reports/sources.md", import.meta.url), lines.join("\n") + "\n");
  console.error("→ wrote reports/sources.md");
}
