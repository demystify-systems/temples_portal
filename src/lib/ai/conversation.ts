/**
 * The call state machine.
 *
 * "Ask the Atlas" answers one typed question at a time. A CALL is different in
 * kind, not degree: it listens without being asked to, decides on its own when
 * you have finished, answers aloud, and goes back to listening — until you hang
 * up. The difference between those two products is almost entirely this file.
 *
 * It is a pure reducer — `(phase, event) -> phase` — with no timers, no audio,
 * no fetch and no React. That is deliberate. Every hard bug in a voice UI is a
 * SEQUENCING bug: a transcript landing after the user hung up, two turns in
 * flight because a slow answer overlapped a fast question, a reply speaking over
 * the next question. Those are unreproducible against a live microphone and
 * trivial against a reducer, so all of the ordering rules live here and the
 * component below only wires I/O to it.
 *
 * The phases, and why each exists:
 *
 *   idle         no microphone, nothing running. The only phase you can leave
 *                by granting permission, and the only one a hang-up returns to.
 *   listening    microphone open, VAD watching, nothing captured yet.
 *   capturing    the person is speaking; audio is being buffered.
 *   transcribing the utterance is with Saarika.
 *   thinking     the transcript is with /api/chat.
 *   speaking     the answer is being read aloud by Bulbul.
 *
 * After `speaking` it returns to `listening`, never to `idle`: the call is still
 * up. That single edge is what makes it feel like a phone call rather than a
 * button that happens to repeat.
 */

export type CallPhase =
  | "idle" | "listening" | "capturing" | "transcribing" | "thinking" | "speaking";

export type CallEvent =
  /** The person pressed call and the microphone was granted. */
  | { readonly type: "start" }
  /** VAD saw a turn open. */
  | { readonly type: "speech-start" }
  /** VAD saw the turn close, or the utterance hit its ceiling. */
  | { readonly type: "speech-end" }
  /** Saarika returned a transcript. Empty means nothing was made out. */
  | { readonly type: "transcript"; readonly text: string }
  /** /api/chat returned an answer. */
  | { readonly type: "answer"; readonly text: string }
  /** Bulbul finished reading the answer, or there was nothing speakable. */
  | { readonly type: "spoke" }
  /** The person spoke over the answer. */
  | { readonly type: "barge-in" }
  /** Anything failed. The call survives; the turn does not. */
  | { readonly type: "error"; readonly message: string }
  /** The person hung up. */
  | { readonly type: "stop" };

/**
 * Next phase for an event, or `null` when the event does not apply here.
 *
 * Returning `null` rather than throwing is the important choice. Late events are
 * NORMAL in this machine — a transcription that resolves after the user hung up
 * is not a bug to be caught, it is a network being slower than a finger. They
 * are ignored, and ignoring them is what keeps a hung-up call from speaking.
 */
export function nextPhase(phase: CallPhase, event: CallEvent): CallPhase | null {
  // Hanging up wins from anywhere, including mid-answer. A call you cannot end
  // while it is talking at you is not a call, it is a hostage situation.
  if (event.type === "stop") return phase === "idle" ? null : "idle";

  // A failed turn returns to listening, not to idle: one failed transcription
  // should not end the call, it should let the person simply say it again.
  if (event.type === "error") return phase === "idle" ? null : "listening";

  switch (phase) {
    case "idle":
      return event.type === "start" ? "listening" : null;

    case "listening":
      return event.type === "speech-start" ? "capturing" : null;

    case "capturing":
      return event.type === "speech-end" ? "transcribing" : null;

    case "transcribing":
      if (event.type !== "transcript") return null;
      // Nothing made out — silence, or a room too loud to hear over. Back to
      // listening WITHOUT a model call: an empty transcript cannot be answered,
      // and paying to be told so is the commonest wasted call in a voice UI.
      return event.text.trim() ? "thinking" : "listening";

    case "thinking":
      if (event.type === "answer") return "speaking";
      // Barge-in during thinking abandons the answer being composed. The person
      // has already moved on; delivering the previous answer over their new
      // question is worse than dropping it.
      if (event.type === "barge-in") return "capturing";
      return null;

    case "speaking":
      if (event.type === "spoke") return "listening";
      if (event.type === "barge-in") return "capturing";
      return null;
  }
}

/** Whether the microphone should be open. It stays open while speaking, for barge-in. */
export const micIsOpen = (phase: CallPhase): boolean => phase !== "idle";

/** Whether VAD output should be acted on. Never while transcribing or thinking. */
export const vadIsLive = (phase: CallPhase): boolean =>
  phase === "listening" || phase === "capturing" || phase === "speaking";

/** Whether an interruption is meaningful right now. */
export const canBargeIn = (phase: CallPhase): boolean =>
  phase === "speaking" || phase === "thinking";

/**
 * What the caller is told the call is doing.
 *
 * Every phase has a line, because a call with no visible state is a call you
 * cannot tell from a hung one — and this is a screen-reader announcement as
 * well as a label, so it says what is happening rather than naming a state.
 */
export const PHASE_LABEL: Readonly<Record<CallPhase, string>> = {
  idle: "Not connected",
  listening: "Listening",
  capturing: "Listening — go on",
  transcribing: "Making out what you said",
  thinking: "Looking through the cited records",
  speaking: "Answering",
};
