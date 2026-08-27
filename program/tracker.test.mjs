// Tripwire: runs every iteration and in CI. A malformed tracker must fail HERE,
// before it drives a scheduling decision. Red tracker => fix the tracker first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const db = JSON.parse(readFileSync(path.join(HERE, "tracker.json"), "utf8"));

const STATUSES = new Set(["pending", "in_progress", "failed", "done", "dead_letter", "needs_human"]);
const TERMINAL = new Set(["done", "dead_letter", "needs_human"]);
const ids = new Set(db.tasks.map((t) => t.id));

test("iteration counter is a non-negative integer", () => {
  assert.ok(Number.isInteger(db.iteration) && db.iteration >= 0);
});

test("every task has the required shape", () => {
  for (const t of db.tasks) {
    for (const k of ["id", "milestone", "type", "title", "files", "deps", "status",
                     "retries", "max_retries", "retry_after_iteration", "evidence"]) {
      assert.ok(k in t, `${t.id ?? "<no id>"}: missing "${k}"`);
    }
    assert.ok(STATUSES.has(t.status), `${t.id}: bad status "${t.status}"`);
    assert.ok(Array.isArray(t.files) && Array.isArray(t.deps) && Array.isArray(t.evidence));
    assert.ok(t.retries <= t.max_retries, `${t.id}: retries exceed the ceiling`);
  }
});

test("task ids are unique", () => {
  assert.equal(ids.size, db.tasks.length);
});

test("every dependency refers to a real task", () => {
  for (const t of db.tasks) {
    for (const d of t.deps) assert.ok(ids.has(d), `${t.id}: unknown dep "${d}"`);
  }
});

test("the dependency graph is acyclic", () => {
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  const state = new Map(); // undefined = unvisited, 1 = on stack, 2 = settled
  const walk = (id, trail) => {
    if (state.get(id) === 2) return;
    assert.ok(state.get(id) !== 1, `cycle: ${[...trail, id].join(" -> ")}`);
    state.set(id, 1);
    for (const d of byId.get(id).deps) walk(d, [...trail, id]);
    state.set(id, 2);
  };
  for (const t of db.tasks) walk(t.id, []);
});

test("no task is done without evidence", () => {
  for (const t of db.tasks) {
    if (t.status === "done") assert.ok(t.evidence.length > 0, `${t.id}: done with no evidence`);
  }
});

test("retries at the ceiling are dead-lettered, not left retryable", () => {
  for (const t of db.tasks) {
    if (t.retries >= t.max_retries && !TERMINAL.has(t.status)) {
      assert.fail(`${t.id}: at the retry ceiling but still "${t.status}"`);
    }
  }
});

test("no open task depends on something that can never finish", () => {
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  for (const t of db.tasks) {
    if (TERMINAL.has(t.status)) continue;
    for (const d of t.deps) {
      const dep = byId.get(d);
      assert.ok(
        dep.status !== "dead_letter" && dep.status !== "needs_human",
        `${t.id} is "${t.status}" behind unfinishable dep ${d} ("${dep.status}") — mark it needs_human`,
      );
    }
  }
});

test("parallel-eligible tasks own disjoint files", () => {
  // Only tasks that can still be dispatched can collide. A done task will never
  // run again, so a later task inheriting its files is not a conflict — it is the
  // normal way a file gets revisited in a second milestone.
  const owner = new Map();
  for (const t of db.tasks) {
    if (TERMINAL.has(t.status)) continue;
    for (const f of t.files) {
      const prev = owner.get(f);
      assert.ok(!prev, `${f} claimed by both ${prev} and ${t.id} — parallel runs would collide`);
      owner.set(f, t.id);
    }
  }
});

test("no task writes data/sites.json (the other session owns it)", () => {
  for (const t of db.tasks) {
    assert.ok(
      !t.files.includes("data/sites.json"),
      `${t.id} declares a write to data/sites.json — forbidden while the batch session is live`,
    );
  }
});
