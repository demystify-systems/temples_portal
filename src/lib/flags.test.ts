import test from "node:test";
import assert from "node:assert/strict";
import { FLAGS, parseFlag } from "./flags.ts";

test("parseFlag is off when the variable is absent", () => {
  assert.equal(parseFlag(undefined), false);
  assert.equal(parseFlag(null), false);
  assert.equal(parseFlag(""), false);
});

test("parseFlag is off for anything it does not recognise", () => {
  // The dangerous ones first: `Boolean("false")` and `Boolean("0")` are both
  // true, which is exactly how a flag gets switched on by accident.
  for (const raw of ["false", "0", "off", "no", "disabled", "maybe", "2", "truthy", "on please", "-"]) {
    assert.equal(parseFlag(raw), false, `${JSON.stringify(raw)} must not switch a flag on`);
  }
});

test("parseFlag accepts the documented spellings, case- and space-insensitively", () => {
  for (const raw of ["1", "true", "on", "yes", "TRUE", "Yes", " on ", "\tTRUE\n"]) {
    assert.equal(parseFlag(raw), true, `${JSON.stringify(raw)} must switch a flag on`);
  }
});

test("the support flag defaults to off", () => {
  // Nothing in this test run sets NEXT_PUBLIC_SUPPORT_PAGE, so this asserts the
  // real default a developer and a fresh CI checkout both get.
  assert.equal(process.env.NEXT_PUBLIC_SUPPORT_PAGE, undefined, "precondition: the var is unset");
  assert.equal(FLAGS.support, false);
});

test("FLAGS cannot be switched on at runtime", () => {
  assert.equal(Object.isFrozen(FLAGS), true);
  assert.throws(() => {
    (FLAGS as { support: boolean }).support = true;
  }, TypeError, "a frozen flag set must reject assignment under strict mode");
  assert.equal(FLAGS.support, false);
});
