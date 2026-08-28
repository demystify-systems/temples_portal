import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_SPEAKERS, DEFAULT_SPEAKER, resolveSpeaker } from "./sarvam.ts";

test("the default is a voice Bulbul actually offers", () => {
  assert.ok(KNOWN_SPEAKERS.includes(DEFAULT_SPEAKER));
});

test("an unset speaker is the default, so an unconfigured deploy is unchanged", () => {
  assert.equal(resolveSpeaker(undefined), DEFAULT_SPEAKER);
  assert.equal(resolveSpeaker(null), DEFAULT_SPEAKER);
  assert.equal(resolveSpeaker(""), DEFAULT_SPEAKER);
  assert.equal(resolveSpeaker("   "), DEFAULT_SPEAKER);
});

test("a configured voice is used, case-insensitively", () => {
  // Sarvam's names are case-sensitive and lowercase; an env var typed in
  // title case is a mistake worth absorbing rather than punishing.
  assert.equal(resolveSpeaker("anushka"), "anushka");
  assert.equal(resolveSpeaker("Anushka"), "anushka");
  assert.equal(resolveSpeaker("  KAVYA  "), "kavya");
});

test("an unknown voice falls back rather than throwing", () => {
  // Including the case this whole question came from: a CLONE id. Sarvam's
  // public API accepts only its own closed list, so a clone id here would be
  // rejected server-side on every single request. Falling back means the atlas
  // still speaks, in a stock voice, instead of going silent for every visitor.
  assert.equal(resolveSpeaker("my-voice-clone-abc123"), DEFAULT_SPEAKER);
  assert.equal(resolveSpeaker("nonexistent"), DEFAULT_SPEAKER);
});

test("the list holds no duplicates and no empty names", () => {
  assert.equal(new Set(KNOWN_SPEAKERS).size, KNOWN_SPEAKERS.length);
  for (const name of KNOWN_SPEAKERS) {
    assert.ok(name.trim().length > 0);
    assert.equal(name, name.toLowerCase(), `${name} must be lowercase — Sarvam's names are case-sensitive`);
  }
});

test("the list matches what the live API enumerated on 2026-08-28", () => {
  // Read off the API by sending an invalid speaker, which answers with the
  // complete list for the calling key. Pinned so that a voice disappearing
  // upstream is noticed here rather than as a 400 in production.
  assert.equal(KNOWN_SPEAKERS.length, 44);
  for (const expected of ["shubh", "anushka", "kavya", "rupali", "gokul"]) {
    assert.ok(KNOWN_SPEAKERS.includes(expected), `${expected} missing`);
  }
});
