"use client";

/**
 * Talk to the atlas: a hold-to-talk microphone, and playback of the answer.
 *
 * Four things here are contract rather than decoration:
 *
 *   1. **The transcript is shown, never sent.** This component hands the text
 *      back to the assistant, which puts it in the input box for the user to
 *      read and correct. A mis-transcription that goes straight to an answer is
 *      indistinguishable from the assistant misunderstanding the question — and
 *      for this audience, that difference is the whole trust of the feature.
 *   2. **The microphone is opened on the first press, never on load.** No
 *      permission prompt appears for a visitor who never asked to speak.
 *   3. **Hold and tap both work.** Holding is the natural gesture and is hard
 *      for anyone with a tremor or a motor impairment, so a short press latches
 *      the recording on and the next press ends it. Keyboard and assistive
 *      technology get the latched path by construction.
 *   4. **Nothing fails silently.** A denied permission, an absent microphone, a
 *      busy microphone, a clip too short to hear — each says what happened and
 *      what to do, in one plain sentence, in the live region below the button.
 *
 * Playback exists because `POST /text-to-speech` returns base64 in JSON rather
 * than a stream (docs/ASSISTANT.md). There is no first byte to play early, so
 * the answer is cut at sentence boundaries and clip *n* plays while clip *n+1*
 * is being synthesised. See `chunkForSpeech`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_RECORDING_MS,
  MAX_SPEECH_CHUNKS,
  base64ToBlob,
  chunkForSpeech,
  elapsedLabel,
  fileNameFor,
  guardAudio,
  languageLabel,
  pickRecordingMime,
  speechLanguage,
} from "@/lib/ai/voice";

/** Below this, a press is a tap and latches the recording on. */
const TAP_MS = 400;
/** How often the elapsed clock ticks. Text, not animation — see the CSS note. */
const TICK_MS = 250;

export type VoiceTranscript = {
  readonly text: string;
  readonly language: string | null;
  readonly label: string | null;
  readonly speakable: boolean;
};

type Phase = "idle" | "opening" | "recording" | "sending";

/**
 * Whether this browser can record at all. Checked on mount rather than during
 * render: `MediaRecorder` does not exist on the server, and a component that
 * disagrees with itself between SSR and hydration is its own bug.
 *
 * `isSecureContext` matters in practice — an http:// origin has no
 * `mediaDevices` at all, and a button that can never work should not be offered.
 */
const canRecord = (): boolean =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  window.isSecureContext;

/** Browser exceptions, translated once, into sentences rather than codes. */
function microphoneProblem(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is blocked for this site. Allow it in your browser's address bar to speak, or type the question instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found on this device. You can type the question instead.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Another app is using the microphone. Close it and try again, or type the question instead.";
  }
  return "The microphone could not be opened. You can type the question instead.";
}

// ---------------------------------------------------------------------------
// the microphone
// ---------------------------------------------------------------------------

export default function VoiceButton({
  onTranscript,
  disabled = false,
}: {
  readonly onTranscript: (result: VoiceTranscript) => void;
  readonly disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [latched, setLatched] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const pressedAtRef = useRef(0);
  /** The user let go before the permission dialog resolved: latch on start. */
  const releasedEarlyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setSupported(canRecord()), []);

  const releaseDevice = useCallback(() => {
    // The browser's recording indicator stays lit until every track is stopped.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    releaseDevice();
  }, [releaseDevice]);

  const send = useCallback(
    async (blob: Blob, durationMs: number) => {
      // The same guard the route will apply, run here first so a clip that
      // cannot succeed never becomes a request.
      const guard = guardAudio({ size: blob.size, durationMs, type: blob.type });
      if (!guard.ok) {
        setPhase("idle");
        setProblem(guard.message);
        return;
      }

      setPhase("sending");
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const form = new FormData();
        form.append("audio", blob, fileNameFor(blob.type));
        form.append("durationMs", String(Math.round(durationMs)));

        const response = await fetch("/api/voice/transcribe", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
        const data: unknown = await response.json().catch(() => null);
        const payload = (data ?? {}) as {
          transcript?: string; language?: string | null; languageLabel?: string | null;
          speakable?: boolean; error?: string; note?: string;
        };

        if (!response.ok) {
          setProblem(payload.error ?? "Voice input is unavailable right now. You can type the question instead.");
          return;
        }
        if (!payload.transcript) {
          setProblem(payload.note ?? "Nothing could be made out. Please try again.");
          return;
        }

        setProblem(null);
        onTranscript({
          text: payload.transcript,
          language: payload.language ?? null,
          label: payload.languageLabel ?? null,
          speakable: Boolean(payload.speakable),
        });
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        setProblem("The recording could not be sent. Check your connection, or type the question instead.");
      } finally {
        abortRef.current = null;
        setPhase("idle");
      }
    },
    [onTranscript],
  );

  /**
   * Idempotent on purpose: the release handler, the AT click and the hard
   * thirty-second cut-off can all reach it, and two of them can arrive in the
   * same tick. `onstop` clears the ref, so a second call finds nothing to do.
   */
  const stop = useCallback(() => {
    setLatched(false);
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "inactive") { releaseDevice(); setPhase("idle"); return; }
    recorder.stop(); // onstop releases the device and uploads what was captured
  }, [releaseDevice]);

  const start = useCallback(async () => {
    if (disabled || phase !== "idle") return;
    setProblem(null);
    setPhase("opening");
    releasedEarlyRef.current = false;

    let stream: MediaStream;
    try {
      // First press only: this is where the permission prompt appears.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      setPhase("idle");
      setProblem(microphoneProblem(error));
      return;
    }

    const mimeType = pickRecordingMime((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      // A browser that reported support and then refused it. Let it choose.
      recorder = new MediaRecorder(stream);
    }

    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size > 0) parts.push(event.data); };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(parts, { type: recorder.mimeType || mimeType || "audio/webm" });
      releaseDevice();
      void send(blob, durationMs);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsed(0);
    recorder.start();
    setPhase("recording");
    // Released while the permission dialog was up: treat it as a tap, so the
    // first press is never the one that mysteriously does nothing.
    if (releasedEarlyRef.current) setLatched(true);
  }, [disabled, phase, releaseDevice, send]);

  // The clock, and the hard stop. One interval does both: the elapsed seconds
  // are what makes the recording state legible without relying on colour.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) {
        setProblem(`Recordings stop at ${MAX_RECORDING_MS / 1000} seconds. Sending what was said.`);
        stop();
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, stop]);

  if (!supported) return null;

  const recording = phase === "recording";
  const busy = phase === "sending" || phase === "opening";

  const press = () => {
    if (recording && latched) { stop(); return; }
    if (phase === "idle") { pressedAtRef.current = Date.now(); void start(); }
  };

  const release = () => {
    if (phase === "opening") { releasedEarlyRef.current = true; return; }
    if (!recording || latched) return;
    if (Date.now() - pressedAtRef.current < TAP_MS) setLatched(true);
    else stop();
  };

  const label = recording
    ? latched ? "Stop recording" : "Recording — release to send"
    : busy ? "Working" : "Hold to speak your question, or tap to start recording";

  return (
    <div className="voxwrap">
      <button
        type="button"
        className={`voxmic${recording ? " on" : ""}`}
        aria-label={label}
        aria-pressed={recording}
        aria-describedby="vox-status"
        disabled={disabled || busy}
        onPointerDown={(event) => {
          // preventDefault stops the press selecting the label or scrolling the
          // sheet — and would also stop the button taking focus, so focus is
          // moved explicitly rather than lost.
          event.preventDefault();
          event.currentTarget.focus();
          press();
        }}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          if (event.repeat) return;
          // Prevents the synthetic click, so the keyboard path is hold-to-talk
          // exactly like the pointer path rather than firing twice.
          event.preventDefault();
          press();
        }}
        onKeyUp={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          release();
        }}
        onClick={(event) => {
          // Only an assistive-technology activation reaches here (`detail: 0`);
          // pointer and key presses are handled above. It toggles, because a
          // screen reader or voice-control user cannot hold a button down.
          if (event.detail !== 0) return;
          if (recording) stop();
          else { pressedAtRef.current = 0; void start(); }
        }}
      >
        <span className="voxicon" aria-hidden="true">
          {recording ? <span className="voxsquare" /> : <span className="voxdot" />}
        </span>
        <span className="voxlabel">
          {recording ? `Recording ${elapsedLabel(elapsed)}` : busy ? "…" : "Speak"}
        </span>
      </button>

      <p id="vox-status" className="voxstatus" role="status">
        {problem
          ? problem
          : recording
            ? latched ? "Recording. Press again to stop." : "Recording. Let go to send."
            : phase === "sending"
              ? "Working out what you said…"
              : phase === "opening"
                ? "Opening the microphone…"
                : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// playback
// ---------------------------------------------------------------------------

/**
 * Read an answer aloud in the language the question was *detected* in.
 *
 * The clips are fetched one ahead of playback. That is the whole answer to
 * base64-in-JSON: the wait before the first sound is one sentence long instead
 * of one paragraph long, and every later clip is already in hand by the time
 * its turn comes.
 *
 * `halt` is a counter the parent increments to stop playback from outside —
 * closing the panel must not leave a voice reciting into an empty room.
 */
export function SpeakButton({
  text,
  language,
  autoPlay = false,
  halt = 0,
}: {
  readonly text: string;
  readonly language: string | null;
  readonly autoPlay?: boolean;
  readonly halt?: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoPlayedRef = useRef(false);

  const speakIn = speechLanguage(language);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    setPlaying(false);
  }, []);

  useEffect(() => () => stop(), [stop]);
  // Parent asked for silence (the panel closed).
  useEffect(() => { if (halt > 0) stop(); }, [halt, stop]);

  const fetchClip = useCallback(
    async (passage: string, signal: AbortSignal): Promise<string[]> => {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ text: passage, language: speakIn }),
      });
      const data: unknown = await response.json().catch(() => null);
      const payload = (data ?? {}) as { audios?: string[]; mime?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The spoken reply is unavailable right now.");
      return (payload.audios ?? []).map((clip) => URL.createObjectURL(base64ToBlob(clip, payload.mime ?? "audio/wav")));
    },
    [speakIn],
  );

  /**
   * Resolves `false` when no sound actually came out — a browser refusing to
   * autoplay, or a clip it would not decode. That has to be distinguishable
   * from "finished playing", or an answer blocked by autoplay policy would
   * fetch and silently discard every remaining clip at full price.
   */
  const playOne = useCallback((url: string, signal: AbortSignal): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      let heard = true;
      const finish = () => {
        audio.onended = null;
        audio.onerror = null;
        signal.removeEventListener("abort", finish);
        URL.revokeObjectURL(url);
        resolve(heard);
      };
      audio.onended = finish;
      audio.onerror = () => { heard = false; finish(); };
      signal.addEventListener("abort", finish, { once: true });
      audio.src = url;
      audio.play().catch(() => { heard = false; finish(); });
    }), []);

  const play = useCallback(async () => {
    if (!speakIn) return;
    const passages = chunkForSpeech(text).slice(0, MAX_SPEECH_CHUNKS);
    if (passages.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setProblem(null);
    setPlaying(true);

    try {
      // One in flight, one playing: clip n+1 is synthesised during clip n.
      let inFlight = fetchClip(passages[0]!, controller.signal);
      for (let i = 0; i < passages.length; i += 1) {
        const urls = await inFlight;
        if (controller.signal.aborted) break;
        inFlight = i + 1 < passages.length
          ? fetchClip(passages[i + 1]!, controller.signal)
          : Promise.resolve([]);
        // Never leave the prefetch rejecting into nothing.
        inFlight.catch(() => []);
        for (const url of urls) {
          if (controller.signal.aborted) { URL.revokeObjectURL(url); continue; }
          const heard = await playOne(url, controller.signal);
          if (!heard && !controller.signal.aborted) {
            setProblem("The answer could not be played here. Press Listen to try again.");
            controller.abort();
          }
        }
        if (controller.signal.aborted) break;
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setProblem((error as Error)?.message ?? "The spoken reply is unavailable right now.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPlaying(false);
    }
  }, [fetchClip, playOne, speakIn, text]);

  useEffect(() => {
    if (!autoPlay || autoPlayedRef.current || !speakIn) return;
    autoPlayedRef.current = true;
    void play();
  }, [autoPlay, play, speakIn]);

  // Heard in a language Bulbul does not speak. Said plainly, and only to
  // someone who asked out loud — a typed question has no reason to be told.
  if (!speakIn) {
    if (!autoPlay) return null;
    return (
      <p className="voxnote">
        The atlas cannot read answers aloud in {languageLabel(language)} yet. The answer is above in full.
      </p>
    );
  }

  return (
    <div className="voxplay">
      <button
        type="button"
        className={`voxspeak${playing ? " on" : ""}`}
        onClick={() => (playing ? stop() : void play())}
        aria-label={playing ? "Stop reading the answer aloud" : "Read the answer aloud"}
      >
        <span aria-hidden="true">{playing ? "■" : "▶"}</span>
        {playing ? "Stop" : "Listen"}
      </button>
      {problem && <span className="voxnote" role="status">{problem}</span>}
    </div>
  );
}
