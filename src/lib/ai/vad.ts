/**
 * Voice activity detection — deciding, from audio alone, when a person started
 * and stopped speaking.
 *
 * This is what turns "hold the button while you talk" into a phone call. The
 * existing voice button records while held and uploads on release, so the
 * person has to know they are addressing a machine and operate it. A call does
 * not work that way: you speak, you stop, and the other side answers.
 *
 * Why detection happens in the BROWSER
 * ------------------------------------
 * Sarvam has a realtime WebSocket (`wss://api.sarvam.ai/speech-to-text-realtime/ws`,
 * model `saaras:v3-realtime`) that does server-side VAD and emits
 * `transcript.partial` / `transcript.final` frames. It is genuinely better: it
 * gives partial text while you are still talking.
 *
 * It is not what this uses, for one reason. The browser's WebSocket constructor
 * cannot set headers, so a browser can only authenticate to that socket by
 * putting `SARVAM_API_KEY` in a subprotocol — which ships the key to every
 * visitor of a public site. Reaching it safely needs a server-side socket proxy
 * holding the key. That proxy is worth building; it is not worth blocking a
 * working conversation on, and this module is the half that does not change
 * when it arrives. `detectTurn` decides turn boundaries locally; swapping the
 * transport underneath it does not alter the state machine in conversation.ts.
 *
 * Everything here is PURE — it takes numbers and returns a decision — so it is
 * testable under `node --test` with no AudioContext, no microphone and no
 * fake timers.
 */

/** Tuning, in one place. Every value was chosen against a stated failure mode. */
export const VAD = {
  /**
   * RMS amplitude (0-1) above which a frame counts as speech.
   *
   * Deliberately not silence-floor-hugging. A room with a fan, a laptop on a
   * desk, or a phone held near clothing sits around 0.005-0.012 RMS; speech at
   * arm's length is 0.05-0.3. Sitting at 0.02 means ambient noise alone never
   * opens a turn, at the cost of missing a genuine whisper — the right way round,
   * because a false turn start sends silence to a paid API and answers a
   * question nobody asked.
   */
  SPEECH_RMS: 0.02,
  /**
   * How long speech must persist before a turn opens. A cough, a door, a chair
   * scrape all clear the amplitude threshold; almost nothing that is not speech
   * sustains it for a quarter of a second.
   */
  MIN_SPEECH_MS: 250,
  /**
   * Silence that ends a turn.
   *
   * The single most consequential number in a voice UI. Too short and it
   * interrupts anyone who pauses mid-sentence to think — which is exactly what
   * people do when asked to name a temple they half-remember. Too long and every
   * exchange feels laggy. Sarvam's own realtime endpoint defaults to 1000 ms
   * (verified from its `session.begin` echo, not from its docs, which say 500);
   * matching it keeps the two transports behaving the same way.
   */
  SILENCE_MS: 1000,
  /**
   * Hard ceiling on one utterance. Someone who never stops talking, or a stuck
   * open microphone, must not stream indefinitely into a paid transcription.
   */
  MAX_UTTERANCE_MS: 30_000,
  /**
   * Speech required to interrupt the assistant mid-answer (barge-in).
   *
   * Higher than MIN_SPEECH_MS on purpose: while the assistant is speaking, the
   * microphone also hears the assistant. Demanding a longer burst before
   * treating it as an interruption keeps the reply from cutting itself off.
   */
  BARGE_IN_MS: 400,
} as const;

/** Root-mean-square amplitude of one frame of PCM samples in [-1, 1]. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** What the detector is doing between frames. Carried by the caller, never global. */
export type VadState = {
  /** True once MIN_SPEECH_MS of speech has accumulated: a turn is open. */
  readonly speaking: boolean;
  /** Milliseconds of contiguous speech seen while not yet speaking. */
  readonly speechMs: number;
  /** Milliseconds of contiguous silence seen while speaking. */
  readonly silenceMs: number;
  /** Milliseconds since the turn opened. */
  readonly utteranceMs: number;
};

export const initialVadState: VadState = Object.freeze({
  speaking: false, speechMs: 0, silenceMs: 0, utteranceMs: 0,
});

/** What the caller should do about this frame. */
export type TurnEvent = "none" | "speech-start" | "speech-end" | "max-length";

export type VadStep = { readonly state: VadState; readonly event: TurnEvent };

/**
 * Advance the detector by one frame.
 *
 * Pure: same state and inputs give the same result, with no clock of its own —
 * the caller passes elapsed milliseconds. That is what makes a 30-second
 * utterance testable in a loop rather than in thirty seconds.
 *
 * `speech-end` fires once, on the frame that completes SILENCE_MS, and resets
 * the state. `max-length` fires instead when the ceiling is hit, so the caller
 * can close a runaway utterance and still submit what it captured.
 */
export function detectTurn(
  state: VadState,
  frameRms: number,
  frameMs: number,
  options: { readonly speechRms?: number; readonly silenceMs?: number } = {},
): VadStep {
  const threshold = options.speechRms ?? VAD.SPEECH_RMS;
  const silenceLimit = options.silenceMs ?? VAD.SILENCE_MS;
  const isSpeech = frameRms >= threshold;

  if (!state.speaking) {
    // Contiguous speech only: a frame of silence resets the run, so two
    // unrelated clicks a second apart never add up to a turn.
    const speechMs = isSpeech ? state.speechMs + frameMs : 0;
    if (speechMs >= VAD.MIN_SPEECH_MS) {
      return {
        state: { speaking: true, speechMs: 0, silenceMs: 0, utteranceMs: speechMs },
        event: "speech-start",
      };
    }
    return { state: { ...initialVadState, speechMs }, event: "none" };
  }

  const utteranceMs = state.utteranceMs + frameMs;
  if (utteranceMs >= VAD.MAX_UTTERANCE_MS) {
    return { state: initialVadState, event: "max-length" };
  }

  // Any speech clears the silence run: a pause mid-sentence must not end a turn
  // just because it was long enough in aggregate.
  const silenceMs = isSpeech ? 0 : state.silenceMs + frameMs;
  if (silenceMs >= silenceLimit) {
    return { state: initialVadState, event: "speech-end" };
  }
  return { state: { speaking: true, speechMs: 0, silenceMs, utteranceMs }, event: "none" };
}

/**
 * Whether sustained speech during the assistant's reply should interrupt it.
 *
 * Separate from `detectTurn` because the question is different: not "has a turn
 * begun" but "is this person talking over the answer". The higher threshold is
 * the echo allowance described on BARGE_IN_MS.
 */
export const shouldBargeIn = (speechMs: number): boolean => speechMs >= VAD.BARGE_IN_MS;
