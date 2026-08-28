import test from "node:test";
import assert from "node:assert/strict";
import { rms, detectTurn, initialVadState, shouldBargeIn, VAD, type VadState } from "./vad.ts";

const FRAME = 20; // ms per frame, as the Web Audio worklet delivers them

/** Run frames of a given loudness through the detector, collecting events. */
const run = (start: VadState, frames: readonly (readonly [number, number])[]) => {
  let state = start;
  const events: string[] = [];
  for (const [level, count] of frames) {
    for (let i = 0; i < count; i += 1) {
      const step = detectTurn(state, level, FRAME);
      state = step.state;
      if (step.event !== "none") events.push(step.event);
    }
  }
  return { state, events };
};

const LOUD = 0.15;   // speech at arm's length
const QUIET = 0.004; // a quiet room
const NOISE = 0.012; // a fan, a laptop, clothing against a phone

test("rms is zero for silence and rises with amplitude", () => {
  assert.equal(rms([]), 0);
  assert.equal(rms([0, 0, 0, 0]), 0);
  assert.equal(rms([1, -1, 1, -1]), 1);
  assert.ok(rms([0.5, -0.5]) < rms([0.9, -0.9]));
});

test("a turn opens only after sustained speech", () => {
  // 250ms at 20ms frames is 12.5 frames, so 12 must not open and 13 must.
  const short = run(initialVadState, [[LOUD, 12]]);
  assert.deepEqual(short.events, [], "12 frames (240ms) is a cough, not a turn");
  const enough = run(initialVadState, [[LOUD, 13]]);
  assert.deepEqual(enough.events, ["speech-start"]);
  assert.ok(enough.state.speaking);
});

test("room noise alone never opens a turn, however long it runs", () => {
  // The failure this prevents: a fan opens a turn, silence is transcribed, and
  // the assistant answers a question nobody asked — on a paid API.
  const { events, state } = run(initialVadState, [[NOISE, 500]]); // 10 seconds
  assert.deepEqual(events, []);
  assert.equal(state.speaking, false);
});

test("speech must be contiguous — two separated clicks never add up to a turn", () => {
  const { events } = run(initialVadState, [[LOUD, 8], [QUIET, 5], [LOUD, 8]]);
  assert.deepEqual(events, [], "the silence between them resets the run");
});

test("a turn ends after a full second of silence, and only then", () => {
  const opened = run(initialVadState, [[LOUD, 20]]);
  assert.deepEqual(opened.events, ["speech-start"]);
  // 49 frames is 980ms — not yet.
  const nearly = run(opened.state, [[QUIET, 49]]);
  assert.deepEqual(nearly.events, [], "980ms of silence is a pause, not an ending");
  assert.ok(nearly.state.speaking, "still listening");
  const ended = run(nearly.state, [[QUIET, 1]]);
  assert.deepEqual(ended.events, ["speech-end"]);
  assert.equal(ended.state.speaking, false);
});

test("a pause to think does not end the turn", () => {
  // The real failure mode: someone says "the temple at... " and pauses to
  // remember the name. Three 800ms pauses must not produce three turns.
  const opened = run(initialVadState, [[LOUD, 20]]);
  const { events, state } = run(opened.state, [
    [QUIET, 40], [LOUD, 10],  // 800ms pause, then more speech
    [QUIET, 40], [LOUD, 10],
    [QUIET, 40], [LOUD, 10],
  ]);
  assert.deepEqual(events, [], "each pause was under the limit and speech reset it");
  assert.ok(state.speaking);
});

test("speech-end fires exactly once, not on every subsequent silent frame", () => {
  const opened = run(initialVadState, [[LOUD, 20]]);
  const { events } = run(opened.state, [[QUIET, 300]]); // six seconds of silence
  assert.deepEqual(events, ["speech-end"], "one ending, not 250 of them");
});

test("a runaway utterance is capped rather than streamed forever", () => {
  // A stuck-open microphone must not bill transcription indefinitely.
  const opened = run(initialVadState, [[LOUD, 20]]);
  // The turn opened carrying the 260ms that opened it, so the cap lands this
  // many frames later. Counted rather than approximated, so the assertion is
  // about the cap firing and not about how loosely it was overshot.
  const toCap = Math.ceil((VAD.MAX_UTTERANCE_MS - opened.state.utteranceMs) / FRAME);
  const capped = run(opened.state, [[LOUD, toCap]]);
  assert.deepEqual(capped.events, ["max-length"]);
  assert.equal(capped.state.speaking, false, "the detector resets so the next turn is clean");

  // And the reset is real: continued speech opens a FRESH turn rather than
  // being swallowed, so a long talker is cut into utterances, never dropped.
  const after = run(capped.state, [[LOUD, 13]]);
  assert.deepEqual(after.events, ["speech-start"]);
});

test("several turns run back to back, as a conversation does", () => {
  let state = initialVadState;
  const events: string[] = [];
  for (let turn = 0; turn < 3; turn += 1) {
    const spoke = run(state, [[LOUD, 20]]);
    const stopped = run(spoke.state, [[QUIET, 50]]);
    events.push(...spoke.events, ...stopped.events);
    state = stopped.state;
  }
  assert.deepEqual(events, [
    "speech-start", "speech-end",
    "speech-start", "speech-end",
    "speech-start", "speech-end",
  ]);
});

test("barge-in needs more speech than opening a turn does", () => {
  // While the assistant speaks, the microphone also hears the assistant.
  assert.equal(shouldBargeIn(VAD.MIN_SPEECH_MS), false, "a turn-opening burst is not enough to interrupt");
  assert.equal(shouldBargeIn(VAD.BARGE_IN_MS), true);
  assert.ok(VAD.BARGE_IN_MS > VAD.MIN_SPEECH_MS, "echo allowance");
});

test("the silence window can be overridden without touching the module", () => {
  const opened = run(initialVadState, [[LOUD, 20]]);
  let state = opened.state;
  const events: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    const step = detectTurn(state, QUIET, FRAME, { silenceMs: 300 });
    state = step.state;
    if (step.event !== "none") events.push(step.event);
  }
  assert.deepEqual(events, ["speech-end"], "a shorter window ends the turn sooner");
});
