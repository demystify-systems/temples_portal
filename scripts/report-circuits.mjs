// Circuit correctness report (BACKLOG B2). DETECT ONLY — writes no data (G9).
//
//   node scripts/report-circuits.mjs            # print
//   node scripts/report-circuits.mjs --write    # also write reports/circuits.md
//
// Distinguishes three failure modes that get conflated as "incomplete":
//   overfull   — more members than the tradition has. A correctness bug: a reader
//                who filters to Jyotirlinga and counts 14 concludes we don't know
//                the material. Usually genuine disputed claimants needing a flag.
//   incomplete — fewer members than canonical. Ordinary backlog.
//   polluted   — the value isn't a circuit at all (a tradition, a rank).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const sites = load("../data/sites.json");

const CANONICAL = {
  Jyotirlinga: 12, "Char Dham": 4, "Chota Char Dham": 4, "Panch Kedar": 5,
  "Panch Prayag": 5, "Pancha Bhoota Sthalam": 5, Ashtavinayak: 8,
  "Arupadai Veedu": 6, "Sapta Puri": 7, "Sapta Badri": 7, "Divya Desam": 108,
  "Shakti Peetha": 51, "Panj Takht": 5, "Ashta Lakshmi": 8, "Pancharama": 5,
};
// Values sitting in `circuits` that describe something else entirely.
const NOT_A_CIRCUIT = { "Shakti tradition": "a tradition, not a circuit" };
// Sub-sets that overlap a parent set and inflate its apparent membership.
const SUBSET_OF = { "Maha Shakti Peetha": "Shakti Peetha" };

const rosters = {};
for (const [name, file] of Object.entries({
  "Divya Desam": "../data/rosters/divya_desam.json",
  "Paadal Petra Sthalam": "../data/rosters/paadal_petra.json",
  "Shakti Peetha": "../data/rosters/shakti_peetha.json",
})) {
  try { rosters[name] = load(file).length; } catch { /* roster absent */ }
}

const members = {};
for (const s of sites) for (const c of s.circuits ?? []) (members[c] ??= []).push(s);

const overfull = [], incomplete = [], polluted = [], ok = [], untracked = [];
for (const [circuit, list] of Object.entries(members).sort((a, b) => b[1].length - a[1].length)) {
  const n = list.length;
  if (NOT_A_CIRCUIT[circuit]) { polluted.push({ circuit, n, why: NOT_A_CIRCUIT[circuit] }); continue; }
  if (SUBSET_OF[circuit]) { polluted.push({ circuit, n, why: `overlaps "${SUBSET_OF[circuit]}" — double-counts members` }); continue; }
  const expected = CANONICAL[circuit] ?? rosters[circuit];
  if (expected === undefined) { untracked.push({ circuit, n }); continue; }
  if (n > expected) overfull.push({ circuit, n, expected, list });
  else if (n < expected) incomplete.push({ circuit, n, expected, gap: expected - n });
  else ok.push({ circuit, n });
}

const lines = [];
const say = (s = "") => { lines.push(s); console.log(s); };

say("# Circuit correctness report");
say();
say(`_Generated from ${sites.length} records. Detect-only: this report changes no data (guardrail G9)._`);
say();
say(`- **${overfull.length}** overfull (correctness bugs)`);
say(`- **${incomplete.length}** incomplete (backlog)`);
say(`- **${polluted.length}** taxonomy pollution`);
say(`- **${ok.length}** exactly right`);
say(`- ${untracked.length} with no canonical count to check against`);
say();

if (overfull.length) {
  say("## Overfull — fix these first");
  say();
  say("More members tagged than the tradition recognises. Each extra is either a genuine");
  say("disputed claimant (which needs a `disputed: true` flag and dated, cited prose, per");
  say("guardrail G10) or a mis-tag. Silently listing them all is the worst option.");
  say();
  for (const { circuit, n, expected, list } of overfull) {
    say(`### ${circuit} — ${n} tagged, canonical ${expected}`);
    say();
    for (const s of list) say(`- \`${s.id}\` — ${s.name} (${s.state ?? s.country})`);
    say();
  }
}

if (incomplete.length) {
  say("## Incomplete");
  say();
  say("| Circuit | Tagged | Canonical | Gap |");
  say("|---|---:|---:|---:|");
  for (const { circuit, n, expected, gap } of incomplete.sort((a, b) => b.gap - a.gap)) {
    say(`| ${circuit} | ${n} | ${expected} | ${gap} |`);
  }
  say();
}

if (polluted.length) {
  say("## Taxonomy pollution");
  say();
  for (const { circuit, n, why } of polluted) say(`- **${circuit}** (${n} records) — ${why}`);
  say();
}

if (ok.length) {
  say("## Complete and correct");
  say();
  say(ok.map((o) => `${o.circuit} (${o.n})`).join(" · "));
  say();
}

if (process.argv.includes("--write")) {
  if (!existsSync(new URL("../reports", import.meta.url))) mkdirSync(new URL("../reports", import.meta.url));
  writeFileSync(new URL("../reports/circuits.md", import.meta.url), lines.join("\n") + "\n");
  console.log("\n→ wrote reports/circuits.md");
}
