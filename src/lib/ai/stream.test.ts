import test from "node:test";
import assert from "node:assert/strict";

import { takeCompleteSegments, vetSegment } from "./stream.ts";
import type { AtlasRecord } from "./retrieve.ts";

const rec = (id: string, name: string): AtlasRecord =>
  ({ id, name, sources: [{ l: "https://example.org", t: "src" }] }) as unknown as AtlasRecord;

// ---- buffering -------------------------------------------------------------

test("holds back a sentence until its terminator arrives", () => {
  // Arrange: the model has emitted half a sentence.
  const partial = "Kedarnath sits at 3,583 m in";
  // Act
  const { emit, rest } = takeCompleteSegments(partial);
  // Assert: nothing may be shown — the claim is not yet a claim.
  assert.equal(emit, "");
  assert.equal(rest, partial);
});

test("emits a sentence as soon as it is terminated", () => {
  const { emit, rest } = takeCompleteSegments("It was built in the 8th century. Then");
  // The space between sentences belongs to the NEXT segment, which is what
  // makes the reassembly test below exact.
  assert.equal(emit, "It was built in the 8th century.");
  assert.equal(rest, " Then");
});

test("emits several sentences that arrive in one chunk", () => {
  const { emit, rest } = takeCompleteSegments("One. Two! Three? Four");
  assert.equal(emit, "One. Two! Three?");
  assert.equal(rest, " Four");
});

test("treats danda and double danda as terminators, so Indic prose streams too", () => {
  const { emit, rest } = takeCompleteSegments("मंदिर पुराना है। अगला");
  assert.equal(emit, "मंदिर पुराना है।");
  assert.equal(rest, " अगला");
});

test("a newline ends a segment even without punctuation, so lists stream", () => {
  const { emit } = takeCompleteSegments("- Somnath\n- Dwarka");
  assert.equal(emit, "- Somnath\n");
});

test("reassembling every emit plus the final rest reproduces the input exactly", () => {
  // The guarantee that streaming never drops or duplicates a character.
  const whole = "First one. Second two! Third three?\nA trailing fragment";
  let buffer = "", out = "";
  for (const ch of whole) {
    buffer += ch;
    const { emit, rest } = takeCompleteSegments(buffer);
    out += emit;
    buffer = rest;
  }
  assert.equal(out + buffer, whole);
});

// ---- the citation guarantee, mid-stream ------------------------------------

test("passes a segment that names only cited records", () => {
  const cited = [rec("kedarnath", "Kedarnath Temple")];
  const { text, dropped } = vetSegment("Kedarnath Temple is in Uttarakhand. ", cited, cited);
  // Whitespace is preserved verbatim: the client concatenates these chunks.
  assert.equal(text, "Kedarnath Temple is in Uttarakhand. ");
  assert.deepEqual(dropped, []);
});

test("withholds a segment naming a record no tool returned", () => {
  // The whole point: this must never reach the browser, not even briefly.
  const cited = [rec("kedarnath", "Kedarnath Temple")];
  const corpus = [...cited, rec("somnath", "Somnath Temple")];
  const { text, dropped } = vetSegment("Somnath Temple is in Gujarat. ", cited, corpus);
  assert.equal(text, "");
  assert.deepEqual(dropped, ["Somnath Temple"]);
});

// ---- tool-call deltas ------------------------------------------------------

import { mergeToolCallDeltas, type ToolCallAccumulator } from "./stream.ts";

test("assembles a tool call whose arguments arrive in fragments", () => {
  // Arrange: exactly how an OpenAI-shaped stream delivers one call.
  let acc: ToolCallAccumulator = {};
  acc = mergeToolCallDeltas(acc, [{ index: 0, id: "c1", function: { name: "findSites", arguments: '{"q":' } }]);
  acc = mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: '"Kedar' } }]);
  acc = mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: 'nath"}' } }]);
  // Act
  const calls = Object.values(acc);
  // Assert
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.id, "c1");
  assert.equal(calls[0]!.function.name, "findSites");
  assert.equal(calls[0]!.function.arguments, '{"q":"Kedarnath"}');
});

test("keeps two concurrent tool calls apart by index", () => {
  let acc: ToolCallAccumulator = {};
  acc = mergeToolCallDeltas(acc, [
    { index: 0, id: "a", function: { name: "findSites", arguments: '{"q":"a"' } },
    { index: 1, id: "b", function: { name: "getSite", arguments: '{"id":' } },
  ]);
  acc = mergeToolCallDeltas(acc, [{ index: 1, function: { arguments: '"x"}' } }]);
  acc = mergeToolCallDeltas(acc, [{ index: 0, function: { arguments: "}" } }]);
  assert.equal(acc[0]!.function.arguments, '{"q":"a"}');
  assert.equal(acc[1]!.function.arguments, '{"id":"x"}');
  assert.equal(acc[1]!.function.name, "getSite");
});

test("merging nothing leaves the accumulator untouched", () => {
  const acc: ToolCallAccumulator = { 0: { id: "a", type: "function", function: { name: "n", arguments: "{}" } } };
  assert.deepEqual(mergeToolCallDeltas(acc, []), acc);
  assert.deepEqual(mergeToolCallDeltas(acc, undefined), acc);
});

test("does not mutate the accumulator it is given", () => {
  // The codebase's immutability rule, and a real hazard here: the accumulator
  // is rebuilt on every frame of a hot loop.
  const before: ToolCallAccumulator = { 0: { id: "a", type: "function", function: { name: "n", arguments: "{" } } };
  const snapshot = JSON.stringify(before);
  mergeToolCallDeltas(before, [{ index: 0, function: { arguments: "}" } }]);
  assert.equal(JSON.stringify(before), snapshot);
});
