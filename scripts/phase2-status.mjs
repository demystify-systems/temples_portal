// Phase 2 tracker — GENERATED, never hand-edited.
//
//   node scripts/phase2-status.mjs           # print the live status
//   node scripts/phase2-status.mjs --write   # also regenerate PHASE2_TRACKER.md
//
// Every number below is read from the repo itself (data/targets, data/batches,
// data/sites.json), so the tracker cannot drift from reality: if a batch agent
// died half way, its row shows the partial count instead of a claimed one.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_DIR = path.join(ROOT, "data", "targets");
const BATCH_DIR = path.join(ROOT, "data", "batches");
const GOAL = 1000;

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const tryJson = (p) => { try { return readJson(p); } catch { return null; } };

const sites = readJson(path.join(ROOT, "data", "sites.json"));
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const liveNames = new Set(sites.map((s) => norm(s.name)));

const batchNums = readdirSync(TARGET_DIR)
  .map((f) => f.match(/^agent_batch_(\d+)\.json$/)?.[1])
  .filter(Boolean)
  .sort();

const rows = batchNums.map((n) => {
  const targets = readJson(path.join(TARGET_DIR, `agent_batch_${n}.json`));
  const outPath = path.join(BATCH_DIR, `records_${n}.json`);
  const records = existsSync(outPath) ? tryJson(outPath) : null;
  const built = Array.isArray(records) ? records.length : 0;
  const landed = Array.isArray(records) ? records.filter((r) => liveNames.has(norm(r?.name))).length : 0;
  const state = !existsSync(outPath) ? "not started"
    : records === null ? "OUTPUT INVALID JSON"
    : landed === built && built > 0 ? "merged"
    : built > 0 ? "built, not merged"
    : "empty";
  return {
    batch: n,
    targets: targets.length,
    built,
    landed,
    state,
    mtime: existsSync(outPath) ? statSync(outPath).mtime.toISOString().slice(0, 16).replace("T", " ") : "—",
  };
});

const totals = rows.reduce((a, r) => ({
  targets: a.targets + r.targets,
  built: a.built + r.built,
  landed: a.landed + r.landed,
}), { targets: 0, built: 0, landed: 0 });

const countries = new Set(sites.map((s) => s.country)).size;
const flagship = sites.filter((s) => s.tier !== "compact").length;
const circuits = new Set(sites.flatMap((s) => s.circuits ?? [])).size;
const unsourced = sites.filter((s) => !Array.isArray(s.sources) || s.sources.length === 0).length;

const pad = (v, n) => String(v).padEnd(n);
const lines = [];
lines.push("", `Tirtha Atlas — Phase 2 status`, "");
lines.push(`  database   ${sites.length} sites · ${countries} countries · ${circuits} circuits · ${flagship} flagship / ${sites.length - flagship} compact`);
lines.push(`  goal       ${GOAL}+ sites — ${sites.length >= GOAL ? "REACHED" : `${GOAL - sites.length} to go`}`);
lines.push(`  unsourced  ${unsourced} ${unsourced === 0 ? "✓" : "✗ these cannot publish"}`);
lines.push("");
lines.push(`  batch  targets  built  in db  state                 output written`);
for (const r of rows) {
  lines.push(`   ${pad(r.batch, 5)} ${pad(r.targets, 8)} ${pad(r.built, 6)} ${pad(r.landed, 6)} ${pad(r.state, 21)} ${r.mtime}`);
}
lines.push(`   ${pad("all", 5)} ${pad(totals.targets, 8)} ${pad(totals.built, 6)} ${pad(totals.landed, 6)}`);
lines.push("");

const text = lines.join("\n");
console.log(text);

if (process.argv.includes("--write")) {
  const md = [
    "# Phase 2 tracker",
    "",
    "> **Generated file — do not hand-edit.** Regenerate with `npm run status:write`.",
    "> Every figure is read from `data/targets/`, `data/batches/` and `data/sites.json`,",
    "> so a claimed batch that never landed shows up as such.",
    "",
    "## Database",
    "",
    "| | |",
    "|---|---|",
    `| Sites | **${sites.length}** (goal ${GOAL}+ — ${sites.length >= GOAL ? "reached" : `${GOAL - sites.length} to go`}) |`,
    `| Countries | ${countries} |`,
    `| Circuits | ${circuits} |`,
    `| Tiers | ${flagship} flagship · ${sites.length - flagship} compact |`,
    `| Unsourced records | ${unsourced}${unsourced === 0 ? " ✓" : " ✗ — these cannot publish"} |`,
    "",
    "## Record batches",
    "",
    "| Batch | Targets | Built | In database | State | Output written |",
    "|---|---:|---:|---:|---|---|",
    ...rows.map((r) => `| ${r.batch} | ${r.targets} | ${r.built} | ${r.landed} | ${r.state} | ${r.mtime} |`),
    `| **all** | **${totals.targets}** | **${totals.built}** | **${totals.landed}** | | |`,
    "",
    "Targets not built are the ones correctly **skipped**: no Wikipedia article, no",
    "coordinates from any source, or already in the database. Skipping is the required",
    "behaviour — `CLAUDE.md` rule 2, no source → no field → no publish.",
    "",
    "## Gates",
    "",
    "```bash",
    "npm run validate   # data gate — every record sourced, in bounds, well formed",
    "npm run build      # validate, then the static build (all pages prerendered)",
    "npm run status     # this tracker, printed",
    "```",
    "",
  ].join("\n");
  writeFileSync(path.join(ROOT, "PHASE2_TRACKER.md"), md);
  console.log("  wrote PHASE2_TRACKER.md\n");
}
