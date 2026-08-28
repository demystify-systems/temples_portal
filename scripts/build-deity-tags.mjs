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

// Matching is TOKEN-AWARE, and that is the whole trick.
//
// A suffix rule must never fire on a word that is already a known deity name.
// "-eshvara" marks a Shiva temple, but "Venkateshvara" is Vishnu — running the
// suffix over the raw string tagged Tirumala as Shaiva. So: aliases claim their
// words first, and only the words nothing claimed are offered to the suffixes.
const canon = Object.entries(vocab.canonical);

const single = new Map();   // one-word alias -> deity name
const phrases = [];         // multi-word alias -> {re, name}
const suffixes = [];        // {re, name}
const groupOf = Object.fromEntries(canon.map(([n, d]) => [n, d.group]));

for (const [name, def] of canon) {
  for (const a of def.aliases ?? []) {
    const t = norm(a);
    if (!t) continue;
    if (t.includes(" ")) phrases.push({ re: new RegExp(`\\b${esc(t)}\\b`), name });
    else if (!single.has(t)) single.set(t, name);
  }
  for (const sfx of def.suffixes ?? []) suffixes.push({ re: new RegExp(`${esc(norm(sfx))}$`), name });
}

const ALLOWED = {
  Hindu: new Set(["Shaiva", "Vaishnava", "Shakta", "Smarta"]),
  Jain: new Set(["Jain"]),
  Buddhist: new Set(["Buddhist", "Shakta"]),  // Tara is a Mahavidya and a bodhisattva both
  Sikh: new Set(["Sikh"]),
};

const groupRank = ["Jain", "Buddhist", "Sikh", "Shakta", "Vaishnava", "Shaiva", "Smarta"];

/** Returns the deities named in one string, honouring the tradition allow-list. */
function scan(text, allowed) {
  const found = new Set();
  if (!text) return found;

  // 1. multi-word aliases, on the whole string
  for (const p of phrases) if (allowed.has(groupOf[p.name]) && p.re.test(text)) found.add(p.name);

  // 2. single-word aliases, per token — and remember which tokens were claimed
  const tokens = text.split(" ").filter(Boolean);
  const claimed = new Array(tokens.length).fill(false);
  tokens.forEach((tok, i) => {
    const hit = single.get(tok);
    if (hit && allowed.has(groupOf[hit])) { found.add(hit); claimed[i] = true; }
    else if (hit) claimed[i] = true;   // claimed by an out-of-tradition deity: still not free for a suffix
  });

  // 3. suffixes, only on tokens no alias claimed
  tokens.forEach((tok, i) => {
    if (claimed[i]) return;
    for (const sf of suffixes) {
      if (!allowed.has(groupOf[sf.name])) continue;
      if (sf.re.test(tok)) { found.add(sf.name); break; }
    }
  });
  return found;
}

function tagsFor(site) {
  const allowed = ALLOWED[site.tradition] ?? new Set();
  const fromDeity = scan(norm(site.deity), allowed);
  const deities = fromDeity.size
    ? [...fromDeity]
    : [...scan(norm(`${site.name ?? ""} ${site.alt ?? ""}`), allowed)];
  if (!deities.length) return null;
  deities.sort();
  const groups = deities.map((d) => groupOf[d]);
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
