import test from "node:test";
import assert from "node:assert/strict";
import {
  nextPhase, micIsOpen, vadIsLive, canBargeIn, PHASE_LABEL,
  type CallPhase, type CallEvent,
} from "./conversation.ts";

const ALL_PHASES: readonly CallPhase[] = [
  "idle", "listening", "capturing", "transcribing", "thinking", "speaking",
];

/** Drive the machine through a script, returning every phase it passed through. */
const drive = (start: CallPhase, events: readonly CallEvent[]): CallPhase[] => {
  let phase = start;
  const seen = [phase];
  for (const event of events) {
    const next = nextPhase(phase, event);
    if (next !== null) { phase = next; seen.push(phase); }
  }
  return seen;
};

test("one full turn runs listen -> capture -> transcribe -> think -> speak -> listen", () => {
  const seen = drive("idle", [
    { type: "start" },
    { type: "speech-start" },
    { type: "speech-end" },
    { type: "transcript", text: "where is the Jagannath temple" },
    { type: "answer", text: "Puri, Odisha." },
    { type: "spoke" },
  ]);
  assert.deepEqual(seen, [
    "idle", "listening", "capturing", "transcribing", "thinking", "speaking", "listening",
  ]);
});

test("the call returns to listening, not idle — that edge is what makes it a call", () => {
  assert.equal(nextPhase("speaking", { type: "spoke" }), "listening");
  assert.notEqual(nextPhase("speaking", { type: "spoke" }), "idle");
});

test("three turns run back to back without being restarted", () => {
  let phase: CallPhase = "listening";
  for (let i = 0; i < 3; i += 1) {
    for (const event of [
      { type: "speech-start" }, { type: "speech-end" },
      { type: "transcript", text: "q" }, { type: "answer", text: "a" }, { type: "spoke" },
    ] as CallEvent[]) {
      phase = nextPhase(phase, event) ?? phase;
    }
    assert.equal(phase, "listening", `turn ${i + 1} did not return to listening`);
  }
});

test("an empty transcript costs nothing — it never reaches the model", () => {
  // Silence, or a room too loud to hear over. Paying a model to be told there
  // was no question is the commonest wasted call in a voice UI.
  assert.equal(nextPhase("transcribing", { type: "transcript", text: "" }), "listening");
  assert.equal(nextPhase("transcribing", { type: "transcript", text: "   " }), "listening");
  assert.equal(nextPhase("transcribing", { type: "transcript", text: "a real question" }), "thinking");
});

test("hanging up works from every phase, including mid-answer", () => {
  for (const phase of ALL_PHASES) {
    const expected = phase === "idle" ? null : "idle";
    assert.equal(nextPhase(phase, { type: "stop" }), expected, `stop failed in ${phase}`);
  }
});

test("a failed turn drops the turn, never the call", () => {
  for (const phase of ALL_PHASES.filter((p) => p !== "idle")) {
    assert.equal(
      nextPhase(phase, { type: "error", message: "network" }), "listening",
      `an error in ${phase} should return to listening so the person can just say it again`,
    );
  }
  assert.equal(nextPhase("idle", { type: "error", message: "x" }), null, "no call to fail");
});

test("late events are ignored rather than acted on", () => {
  // The bug this prevents: a transcription resolves after the user hung up and
  // the assistant starts talking to an empty room.
  assert.equal(nextPhase("idle", { type: "transcript", text: "hello" }), null);
  assert.equal(nextPhase("idle", { type: "answer", text: "hello" }), null);
  assert.equal(nextPhase("idle", { type: "spoke" }), null);
  // And a stale answer arriving while already listening again.
  assert.equal(nextPhase("listening", { type: "answer", text: "stale" }), null);
  assert.equal(nextPhase("listening", { type: "spoke" }), null);
});

test("speaking over the answer interrupts it and starts a new turn", () => {
  assert.equal(nextPhase("speaking", { type: "barge-in" }), "capturing");
});

test("speaking over a pending answer abandons it", () => {
  // The person moved on. Delivering the old answer over the new question is
  // worse than dropping it.
  assert.equal(nextPhase("thinking", { type: "barge-in" }), "capturing");
});

test("barge-in is inert where there is nothing to interrupt", () => {
  for (const phase of ["idle", "listening", "capturing", "transcribing"] as CallPhase[]) {
    assert.equal(nextPhase(phase, { type: "barge-in" }), null, `barge-in should be inert in ${phase}`);
  }
});

test("a second speech-start cannot open a turn inside a turn", () => {
  assert.equal(nextPhase("capturing", { type: "speech-start" }), null);
  assert.equal(nextPhase("transcribing", { type: "speech-start" }), null);
  assert.equal(nextPhase("thinking", { type: "speech-start" }), null);
});

test("the microphone stays open while the assistant speaks, so it can be interrupted", () => {
  assert.equal(micIsOpen("speaking"), true);
  assert.equal(micIsOpen("idle"), false);
  for (const phase of ALL_PHASES.filter((p) => p !== "idle")) assert.equal(micIsOpen(phase), true);
});

test("VAD is deaf while transcribing and thinking", () => {
  // Otherwise the machine's own latency reads as the person starting a new turn.
  assert.equal(vadIsLive("transcribing"), false);
  assert.equal(vadIsLive("thinking"), false);
  assert.equal(vadIsLive("listening"), true);
  assert.equal(vadIsLive("capturing"), true);
  assert.equal(vadIsLive("speaking"), true, "needed for barge-in");
});

test("canBargeIn agrees with the transitions that accept a barge-in", () => {
  for (const phase of ALL_PHASES) {
    const accepted = nextPhase(phase, { type: "barge-in" }) !== null;
    assert.equal(canBargeIn(phase), accepted, `canBargeIn disagrees with the reducer in ${phase}`);
  }
});

test("every phase has a label that describes what is happening", () => {
  for (const phase of ALL_PHASES) {
    const label = PHASE_LABEL[phase];
    assert.ok(label && label.length > 0, `${phase} has no label`);
    // It is a screen-reader announcement, so it must not just name the state.
    assert.ok(!/^(idle|listening|capturing|transcribing|thinking|speaking)$/i.test(label)
      || phase === "listening", `${phase} label just names the state`);
  }
});

test("no event can strand the machine outside its phase set", () => {
  const events: CallEvent[] = [
    { type: "start" }, { type: "speech-start" }, { type: "speech-end" },
    { type: "transcript", text: "x" }, { type: "transcript", text: "" },
    { type: "answer", text: "y" }, { type: "spoke" }, { type: "barge-in" },
    { type: "error", message: "e" }, { type: "stop" },
  ];
  for (const phase of ALL_PHASES) {
    for (const event of events) {
      const next = nextPhase(phase, event);
      assert.ok(next === null || ALL_PHASES.includes(next), `${phase} + ${event.type} -> ${next}`);
    }
  }
});
