import test from "node:test";
import assert from "node:assert/strict";

import { pageContext, contextLabel } from "./page-context.ts";

test("a record page is read as that record", () => {
  // Arrange / Act
  const ctx = pageContext("/site/brihadisvara-thanjavur");
  // Assert
  assert.deepEqual(ctx, { kind: "site", id: "brihadisvara-thanjavur" });
});

test("every indexed kind is recognised, because each one is a subject", () => {
  for (const [path, kind] of [
    ["/dynasty/chola", "dynasty"],
    ["/circuit/divya-desam", "circuit"],
    ["/deity/shiva", "deity"],
    ["/patron/ahilyabai-holkar", "patron"],
  ] as const) {
    assert.deepEqual(pageContext(path), { kind, id: path.split("/")[2] });
  }
});

test("the map and the gazetteer are places, not subjects", () => {
  assert.deepEqual(pageContext("/"), { kind: "map" });
  assert.deepEqual(pageContext("/sites"), { kind: "gazetteer" });
});

test("a trailing slash and a query string change nothing", () => {
  assert.deepEqual(pageContext("/site/kedarnath/"), { kind: "site", id: "kedarnath" });
  assert.deepEqual(pageContext("/site/kedarnath?from=search"), { kind: "site", id: "kedarnath" });
});

test("an unknown route carries no context rather than a guessed one", () => {
  // A wrong subject is worse than none: it would answer a question about the
  // page the reader is NOT on.
  assert.equal(pageContext("/about"), null);
  assert.equal(pageContext("/support"), null);
  assert.equal(pageContext("/nonsense/thing"), null);
  assert.equal(pageContext(""), null);
});

test("a slug that is not a slug is refused", () => {
  // This id reaches a corpus lookup, so it is constrained at the boundary
  // rather than trusted because it came from our own router.
  assert.equal(pageContext("/site/../../etc/passwd"), null);
  assert.equal(pageContext("/site/" + "x".repeat(200)), null);
  assert.equal(pageContext("/site/Has Spaces"), null);
});

test("the label names the page in words the prompt can use", () => {
  assert.equal(contextLabel({ kind: "site", id: "kedarnath" }), "the page for one specific site");
  assert.equal(contextLabel({ kind: "dynasty", id: "chola" }), "a dynasty's page");
  assert.equal(contextLabel({ kind: "map" }), "the atlas map");
  assert.equal(contextLabel(null), null);
});
