// Derive `deities` and `deityGroup` tags onto data/sites.json from the free-text
// `deity` field, using data/vocab/deity.json.
//
//   node scripts/build-deity-tags.mjs            # report what would change
//   node scripts/build-deity-tags.mjs --apply    # write the tags
//
// Why this exists: `deity` is prose — "Shiva as Edaganathar, with Parvati as
// Elavaarkuzhali", "Devi Bargabhima (Kapalini / Bhimarupa), a form of Kali" — and
// 2,276 distinct strings across the corpus. It is the right thing to SHOW and the
// wrong thing to FILTER on. These tags are the filterable index beside it.
//
// This adds no facts. A tag is only ever recognised in text the record already
// carries (CLAUDE.md rule 2), and a record whose `deity` names no recognisable
// figure gets no tag rather than a guessed one.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITES = path.join(ROOT, "data", "sites.json");
const VOCAB = path.join(ROOT, "data", "vocab", "deity.json");
const apply = process.argv.includes("--apply");

const vocab = JSON.parse(readFileSync(VOCAB, "utf8"));
const sites = JSON.parse(readFileSync(SITES, "utf8"));

const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Aliases match on a word boundary; suffixes match the tail of a word, because
// "Sundareswarar" and "Kapaleeshwarar" encode Shiva in the ending itself.
const matchers = Object.entries(vocab.canonical).map(([name, def]) => ({
  name,
  group: def.group,
  alias: new RegExp(`\\b(${(def.aliases ?? []).map((a) => esc(norm(a))).filter(Boolean).join("|")})`, "i"),
  suffix: (def.suffixes ?? []).length
    ? new RegExp(`(${def.suffixes.map((s) => esc(norm(s))).join("|")})\\b`, "i")
    : null,
}));

// The tradition constrains which tags are even possible: a Buddhist vihara whose
// name ends in -natha is not a Shiva temple.
const ALLOWED = {
  Hindu: new Set(["Shaiva", "Vaishnava", "Shakta", "Smarta"]),
  Jain: new Set(["Jain"]),
  Buddhist: new Set(["Buddhist", "Shakta"]),  // Tara is a Mahavidya and a bodhisattva both
  Sikh: new Set(["Sikh"]),
};

/** Priority order when a record resolves to several groups. */
const groupRank = ["Jain", "Buddhist", "Sikh", "Shakta", "Vaishnava", "Shaiva", "Smarta"];

function tagsFor(site) {
  const primary = norm(site.deity);                         // the dedication, and the strongest signal
  const secondary = norm(`${site.name ?? ""} ${site.alt ?? ""}`); // the name often encodes it too
  const allowed = ALLOWED[site.tradition] ?? new Set();

  const hits = new Map();                                   // name -> weight (2 = from deity, 1 = from name)
  for (const m of matchers) {
    if (!allowed.has(m.group)) continue;
    if (m.alias.source !== "\\b()" && m.alias.test(primary)) hits.set(m.name, 2);
    else if (m.suffix?.test(primary)) hits.set(m.name, 2);
    else if (m.alias.source !== "\\b()" && m.alias.test(secondary)) hits.set(m.name, Math.max(hits.get(m.name) ?? 0, 1));
    else if (m.suffix?.test(secondary)) hits.set(m.name, Math.max(hits.get(m.name) ?? 0, 1));
  }
  if (!hits.size) return null;

  // Keep deity-derived tags; fall back to name-derived only when the deity gave nothing.
  const strong = [...hits].filter(([, w]) => w === 2).map(([n]) => n);
  const deities = (strong.length ? strong : [...hits.keys()]).sort();

  const groups = deities.map((d) => vocab.canonical[d].group);
  const deityGroup = groupRank.find((g) => groups.includes(g)) ?? groups[0];
  return { deities, deityGroup };
}

let tagged = 0, untagged = 0;
const byTag = {}, byGroup = {}, misses = [];

const out = sites.map((s) => {
  const t = tagsFor(s);
  if (!t) {
    untagged++;
    if (misses.length < 40) misses.push(`${s.tradition.padEnd(9)} ${s.deity}`);
    const { deities, deityGroup, ...rest } = s;      // clear any stale tags
    return rest;
  }
  tagged++;
  for (const d of t.deities) byTag[d] = (byTag[d] ?? 0) + 1;
  byGroup[t.deityGroup] = (byGroup[t.deityGroup] ?? 0) + 1;
  return { ...s, deities: t.deities, deityGroup: t.deityGroup };
});

console.log(`\nbuild-deity-tags — ${sites.length} records`);
console.log(`  tagged   ${tagged}  (${((tagged / sites.length) * 100).toFixed(1)}%)`);
console.log(`  untagged ${untagged}\n`);
console.log("  by group: " + Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(" · "));
console.log("\n  top tags:");
for (const [d, n] of Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`    ${String(n).padStart(5)}  ${d}`);
if (misses.length) {
  console.log(`\n  a sample of what stayed untagged (no recognised figure — correctly left alone):`);
  for (const m of misses.slice(0, 15)) console.log(`    ${m}`);
}

if (apply) {
  writeFileSync(SITES, JSON.stringify(out, null, 1) + "\n");
  console.log(`\n  wrote data/sites.json\n`);
} else {
  console.log(`\n  report only — re-run with --apply to write the tags\n`);
}
