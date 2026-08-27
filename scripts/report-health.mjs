// Data-health summary (BACKLOG C7). DETECT ONLY.
//   node scripts/report-health.mjs [--write]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const sites = load("../data/sites.json");
const { tiers } = load("../data/vocab/tiers.json");

const has = (r, f) => r[f] !== undefined && r[f] !== null && r[f] !== "" && !(Array.isArray(r[f]) && !r[f].length);
const tierOf = (s) => s.tier ?? "flagship";
const lines = []; const say = (s = "") => { lines.push(s); console.log(s); };
const pct = (n, d = sites.length) => `${Math.round((100 * n) / d)}%`;

say("# Data-health report");
say();
say(`_${sites.length} records · generated from the repo, so it cannot drift from reality._`);
say();

say("## Tier conformance");
say();
say("Does each record actually carry what its tier promises? (`data/vocab/tiers.json`)");
say();
say("| Tier | Records | Fully conformant | Missing fields |");
say("|---|---:|---:|---|");
for (const [name, def] of Object.entries(tiers)) {
  const inTier = sites.filter((s) => tierOf(s) === name);
  if (!inTier.length) { say(`| ${name} | 0 | — | — |`); continue; }
  const missing = {};
  let ok = 0;
  for (const s of inTier) {
    const gaps = def.requires.filter((f) => !has(s, f === "built" ? "built" : f));
    if (!gaps.length) ok += 1;
    for (const g of gaps) missing[g] = (missing[g] ?? 0) + 1;
  }
  const worst = Object.entries(missing).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([f, n]) => `${f} (${n})`).join(", ") || "—";
  say(`| ${name} | ${inTier.length} | ${ok} (${pct(ok, inTier.length)}) | ${worst} |`);
}
say();

say("## Field completeness");
say();
say("| Field | Present | % |");
say("|---|---:|---:|");
for (const f of ["story", "access", "patron", "origin", "originNote", "website", "phone", "native", "circuits", "status", "alt"]) {
  const n = sites.filter((s) => has(s, f)).length;
  say(`| \`${f}\` | ${n} | ${pct(n)} |`);
}
say();

const group = (fn) => sites.reduce((a, s) => ({ ...a, [fn(s)]: (a[fn(s)] ?? 0) + 1 }), {});
const table = (title, obj, limit = 15) => {
  say(`## ${title}`); say();
  say("| Key | Records | % |"); say("|---|---:|---:|");
  for (const [k, n] of Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    say(`| ${k} | ${n} | ${pct(n)} |`);
  }
  say();
};
table("Coverage by country", group((s) => s.country));
table("Coverage by state", group((s) => s.state ?? "—"), 12);
table("Coverage by tradition", group((s) => s.tradition));

const ERAS = [[550,"Ancient"],[1000,"Early medieval"],[1350,"High medieval"],[1650,"Late medieval"],[1850,"Early modern"],[2031,"Modern"]];
table("Coverage by era", group((s) => (ERAS.find(([to]) => s.built[0] < to) ?? [0,"—"])[1]), 8);

const india = sites.filter((s) => s.country === "India").length;
say("## Concentration");
say();
say(`India holds **${india} of ${sites.length}** records (${pct(india)}). The "15 countries" headline`);
say("is carried by countries with very few records each — check the country table above before");
say("using that figure publicly (BACKLOG decision 6, scope discipline).");
say();

if (process.argv.includes("--write")) {
  const d = new URL("../reports", import.meta.url); if (!existsSync(d)) mkdirSync(d);
  writeFileSync(new URL("../reports/health.md", import.meta.url), lines.join("\n") + "\n");
  console.error("→ wrote reports/health.md");
}
