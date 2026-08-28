"use client";

/**
 * The call: microphone in, spoken answer out, no button held.
 *
 * All of the SEQUENCING lives in src/lib/ai/conversation.ts and all of the
 * turn-boundary decisions live in src/lib/ai/vad.ts, both pure and both tested
 * without a browser. This hook is only the wiring: it owns the AudioContext, the
 * MediaRecorder and the three fetches, and it forwards what they produce into
 * the reducer. Keeping it that thin is what makes the hard parts testable —
 * "the answer arrived after hang-up" is a unit test there, not a race here.
 *
 * The recording strategy, which is the one genuinely fiddly part
 * --------------------------------------------------------------
 * A WebM stream from MediaRecorder is only decodable from its first chunk: the
 * headers are in chunk zero, so you cannot slice an utterance out of the middle
 * of a long recording. The obvious design — record continuously and cut on VAD
 * boundaries — produces blobs no decoder will accept.
 *
 * So the recorder is RESTARTED at every turn boundary. Each utterance is its own
 * complete recording, valid from its first byte. The blob therefore also carries
 * whatever silence preceded the speech, which is fine and is in fact the point:
 * it means the 250 ms that VAD spent DECIDING this was speech is inside the
 * recording rather than clipped off the front of the first word.
 *
 * A silent stretch also restarts it every SILENT_RESTART_MS, so a call left open
 * in a quiet room does not accumulate minutes of silence in memory.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { detectTurn, initialVadState, rms, shouldBargeIn, VAD, type VadState } from "@/lib/ai/vad";
import {
  nextPhase, vadIsLive, canBargeIn, PHASE_LABEL, type CallEvent, type CallPhase,
} from "@/lib/ai/conversation";
import { chunkForSpeech } from "@/lib/ai/voice";
import { preferredFromLocale } from "@/lib/ai/languages";

/** Analyser frame size. 1024 samples at 48 kHz is ~21 ms — the VAD's frame. */
const FFT_SIZE = 2048;
/** Rebuild the recorder after this much unbroken silence, to bound memory. */
const SILENT_RESTART_MS = 10_000;

export type CallTurn = {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly citations: readonly { readonly id: string; readonly name: string; readonly url: string }[];
  readonly refused: boolean;
};

export type Call = {
  readonly phase: CallPhase;
  readonly label: string;
  readonly turns: readonly CallTurn[];
  /** 0-1, for the level meter. Reading it is what tells someone the mic is live. */
  readonly level: number;
  readonly error: string | null;
  readonly supported: boolean;
  /** The language the person CHOSE, or null for detect-from-audio. */
  readonly language: string | null;
  /** The language actually heard on the last turn, which may differ. */
  readonly heard: string | null;
  setLanguage: (code: string | null) => void;
  start: () => void;
  stop: () => void;
};

/** MediaRecorder and getUserMedia are both absent on the server and in some browsers. */
const isSupported = (): boolean =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  typeof AudioContext !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

let turnId = 0;

export function useCall(): Call {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [turns, setTurns] = useState<readonly CallTurn[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  /**
   * The language the person chose. `null` means detect from the audio, which
   * stays the default: detection is better than a wrong choice, and someone who
   * picks Tamil then asks in English should still be understood.
   */
  const [language, setLanguageState] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isSupported());
    // The device locale preselects the picker and decides nothing else: a
    // locale says where a phone was bought at least as often as what its owner
    // speaks.
    setLanguageState(preferredFromLocale(typeof navigator === "undefined" ? null : navigator.language));
  }, []);

  // Everything below is imperative machinery that must not re-render on change.
  const phaseRef = useRef<CallPhase>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadRef = useRef<VadState>(initialVadState);
  const bargeMsRef = useRef(0);
  const silentMsRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const languageRef = useRef<string | null>(null);
  const chosenRef = useRef<string | null>(null);
  chosenRef.current = language;

  /** Single funnel for every transition, so no caller sets a phase directly. */
  const send = useCallback((event: CallEvent) => {
    const next = nextPhase(phaseRef.current, event);
    if (next === null) return null;      // a late or inapplicable event: ignore it
    phaseRef.current = next;
    setPhase(next);
    return next;
  }, []);

  const stopRecorder = useCallback((): Promise<Blob | null> =>
    new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") return resolve(null);
      recorder.onstop = () => {
        const parts = chunksRef.current;
        chunksRef.current = [];
        resolve(parts.length ? new Blob(parts, { type: recorder.mimeType || "audio/webm" }) : null);
      };
      try { recorder.stop(); } catch { resolve(null); }
    }), []);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    } catch {
      recorder = new MediaRecorder(stream); // let the browser pick its own container
    }
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start(100);
    recorderRef.current = recorder;
  }, []);

  /** Stop whatever is being spoken. Used by hang-up and by barge-in. */
  const silence = useCallback(() => {
    const el = audioElRef.current;
    if (el) { el.pause(); el.src = ""; audioElRef.current = null; }
  }, []);

  /** One passage of the answer, synthesised. Returns its clips, or [] on failure. */
  const fetchClips = useCallback(async (passage: string, language: string | null): Promise<string[]> => {
    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: passage, language: language ?? "en-IN" }),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { audios?: string[] };
      return data.audios ?? [];
    } catch { return []; }
  }, []);

  /**
   * Read the answer aloud, one sentence at a time, fetching ahead.
   *
   * Bulbul returns base64 WAV inside JSON, not a stream, so there is no first
   * byte to play early — a whole paragraph in one call is a long silence and
   * then audio. Measured: 3.0s for a full answer. Cutting at sentence
   * boundaries (`chunkForSpeech`, already used by the typed assistant) and
   * fetching passage n+1 WHILE passage n plays makes time-to-first-sound the
   * cost of one sentence instead of one paragraph.
   *
   * On a call that difference is not a nicety. Several seconds of silence after
   * you stop speaking reads as "it did not hear me", and people repeat
   * themselves into it — which barge-in then correctly treats as a new question,
   * so the answer they were waiting for never arrives.
   */
  const speak = useCallback(async (text: string, language: string | null) => {
    const passages = chunkForSpeech(text);
    if (passages.length === 0) return;

    // One passage ahead, no more: the reader can hang up or interrupt at any
    // sentence, and everything fetched past that point is spend for audio that
    // will never play.
    let ahead = fetchClips(passages[0], language);
    for (let i = 0; i < passages.length; i += 1) {
      const clips = await ahead;
      if (phaseRef.current !== "speaking") return;
      ahead = i + 1 < passages.length ? fetchClips(passages[i + 1], language) : Promise.resolve([]);

      for (const clip of clips) {
        // Re-checked between clips as well as between passages: a barge-in
        // during a long answer must stop the NEXT clip, not only the one
        // currently sounding.
        if (phaseRef.current !== "speaking") return;
        await new Promise<void>((resolve) => {
          const el = new Audio(`data:audio/wav;base64,${clip}`);
          audioElRef.current = el;
          el.onended = () => resolve();
          el.onerror = () => resolve();
          el.play().catch(() => resolve());
        });
      }
    }
  }, [fetchClips]);

  /** One complete turn: audio -> transcript -> answer -> speech. */
  const runTurn = useCallback(async (audio: Blob, durationMs: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const form = new FormData();
      form.append("audio", audio, "utterance.webm");
      form.append("durationMs", String(Math.round(durationMs)));
      // A hint to the transcriber, not a constraint on it.
      if (chosenRef.current) form.append("language", chosenRef.current);
      const heard = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal: controller.signal });
      if (!heard.ok) { send({ type: "error", message: "Could not make that out." }); return; }
      const said = (await heard.json()) as { transcript?: string; language?: string | null };

      // What was actually HEARD wins over what was chosen: it is a measurement,
      // and answering in the language someone actually spoke is the whole point.
      // The choice is the fallback for when detection declines to commit.
      languageRef.current = said.language ?? chosenRef.current ?? languageRef.current;
      setHeard(said.language ?? null);
      const text = (said.transcript ?? "").trim();
      // An empty transcript never reaches the model — see conversation.ts.
      if (send({ type: "transcript", text }) !== "thinking") return;

      setTurns((prev) => [...prev, { id: turnId++, role: "user", text, citations: [], refused: false }]);

      const answered = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ question: text, language: languageRef.current ?? undefined }),
      });
      const payload = (await answered.json().catch(() => null)) as
        { answer?: string; citations?: CallTurn["citations"]; refused?: boolean } | null;

      if (!answered.ok || !payload?.answer) {
        send({ type: "error", message: "The assistant is unavailable right now." });
        return;
      }
      if (send({ type: "answer", text: payload.answer }) !== "speaking") return;

      setTurns((prev) => [...prev, {
        id: turnId++, role: "assistant", text: payload.answer!,
        citations: payload.citations ?? [], refused: Boolean(payload.refused),
      }]);

      await speak(payload.answer, languageRef.current);
      send({ type: "spoke" });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") send({ type: "error", message: "Something went wrong." });
    } finally {
      abortRef.current = null;
      // Whatever happened, the microphone goes back to listening for the next
      // question — a failed turn must never end the call.
      if (phaseRef.current !== "idle") startRecorder();
    }
  }, [send, speak, startRecorder]);

  /** The audio loop. One rAF tick per frame, forwarding levels into the VAD. */
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || phaseRef.current === "idle") return;

    const now = performance.now();
    const frameMs = lastFrameRef.current ? Math.min(100, now - lastFrameRef.current) : 16;
    lastFrameRef.current = now;

    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    const loudness = rms(buffer);
    setLevel(loudness);

    if (vadIsLive(phaseRef.current)) {
      // While the assistant is speaking the microphone also hears the assistant,
      // so interruption is judged on its own longer threshold, not the VAD's.
      if (canBargeIn(phaseRef.current)) {
        bargeMsRef.current = loudness >= VAD.SPEECH_RMS ? bargeMsRef.current + frameMs : 0;
        if (shouldBargeIn(bargeMsRef.current)) {
          bargeMsRef.current = 0;
          silence();
          abortRef.current?.abort();
          if (send({ type: "barge-in" })) { vadRef.current = initialVadState; startRecorder(); }
        }
      } else {
        bargeMsRef.current = 0;
        const step = detectTurn(vadRef.current, loudness, frameMs);
        vadRef.current = step.state;

        if (step.event === "speech-start") {
          silentMsRef.current = 0;
          send({ type: "speech-start" });
        } else if (step.event === "speech-end" || step.event === "max-length") {
          const captured = phaseRef.current === "capturing";
          if (captured && send({ type: "speech-end" })) {
            void stopRecorder().then((blob) => {
              if (blob && blob.size > 0) void runTurn(blob, VAD.SILENCE_MS + VAD.MIN_SPEECH_MS);
              else send({ type: "error", message: "Nothing was recorded." });
            });
          }
        } else if (phaseRef.current === "listening") {
          // Bound the memory a call left open in a quiet room accumulates.
          silentMsRef.current += frameMs;
          if (silentMsRef.current >= SILENT_RESTART_MS) {
            silentMsRef.current = 0;
            void stopRecorder().then(() => { if (phaseRef.current !== "idle") startRecorder(); });
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [runTurn, send, silence, startRecorder, stopRecorder]);

  const stop = useCallback(() => {
    send({ type: "stop" });
    phaseRef.current = "idle";
    abortRef.current?.abort();
    silence();
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioRef.current?.close().catch(() => {});
    audioRef.current = null;
    analyserRef.current = null;
    vadRef.current = initialVadState;
    bargeMsRef.current = 0;
    silentMsRef.current = 0;
    setLevel(0);
  }, [send, silence]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    setError(null);
    try {
      // Echo cancellation is what makes barge-in tractable at all: without it
      // the microphone hears the answer at full volume and interrupts itself.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      audioRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      context.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;

      send({ type: "start" });
      startRecorder();
      lastFrameRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setError("The microphone is not available. Check the permission for this site, or type the question instead.");
    }
  }, [send, startRecorder, tick]);

  useEffect(() => () => { stop(); }, [stop]);

  const setLanguage = useCallback((code: string | null) => {
    setLanguageState(code);
    chosenRef.current = code;
  }, []);

  return {
    phase, label: PHASE_LABEL[phase], turns, level, error, supported,
    language, heard, setLanguage,
    start: () => { void start(); }, stop,
  };
}
