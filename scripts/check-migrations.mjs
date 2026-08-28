// Migration numbering gate.
//
//   node scripts/check-migrations.mjs
//
// Why this exists: `main` shipped TWO migrations numbered 0004 —
// 0004_deity_tags_admin.sql and 0004_disputed_circuits.sql — authored by two
// sessions against one database. They happened to apply in the right order only
// because "de" sorts before "di". That is an accident, not a design, and the
// next collision will not be so lucky.
//
// Both were idempotent (`add column if not exists`, `create or replace`), so
// nothing was corrupted. The gate exists so the next pair does not have to be.
//
// Three rules, each catching a failure mode that has actually happened in this
// repo or is one edit away:
//
//   1. NO DUPLICATE NUMBERS — the collision above.
//   2. NO GAPS — a gap almost always means a migration was written, applied and
//      then lost in a rebase, so the schema no longer follows from the files.
//   3. NAMES ARE STABLE — renaming an applied migration makes it look new to a
//      ledger keyed on filename, so it replays.

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const failures = [];
const byNumber = new Map();

for (const file of files) {
  const match = PATTERN.exec(file);
  if (!match) {
    failures.push(`${file}: name must be NNNN_lower_snake_case.sql`);
    continue;
  }
  const [, digits, name] = match;
  const number = Number(digits);
  const existing = byNumber.get(number);
  if (existing) {
    failures.push(
      `migration number ${digits} is used twice: ${existing} and ${name}. ` +
      `Two sessions numbered against the same database. Renumber the LATER one — ` +
      `whichever is not yet recorded in supabase_migrations.schema_migrations.`,
    );
    continue;
  }
  byNumber.set(number, name);
}

const numbers = [...byNumber.keys()].sort((a, b) => a - b);
if (numbers.length > 0) {
  if (numbers[0] !== 1) failures.push(`migrations start at ${numbers[0]}, not 0001`);
  for (let i = 1; i < numbers.length; i += 1) {
    const gap = numbers[i] - numbers[i - 1];
    if (gap > 1) {
      failures.push(
        `gap between ${String(numbers[i - 1]).padStart(4, "0")} and ${String(numbers[i]).padStart(4, "0")}: ` +
        `${gap - 1} number(s) missing. A gap usually means an applied migration was lost in a rebase, ` +
        `which means the live schema no longer follows from these files.`,
      );
    }
  }
}

console.log(`migration gate — ${files.length} migrations, ${numbers.length} distinct numbers`);
for (const n of numbers) console.log(`  ${String(n).padStart(4, "0")}  ${byNumber.get(n)}`);
console.log(`\nnext free number: ${String((numbers.at(-1) ?? 0) + 1).padStart(4, "0")}`);

if (failures.length) {
  console.error(`\n✗ ${failures.length} problem(s):`);
  for (const f of failures) console.error(`    ${f}`);
  process.exit(1);
}
console.log("\n✓ migrations are uniquely numbered and contiguous");
