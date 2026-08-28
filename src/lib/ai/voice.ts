/**
 * Voice helpers — the parts of "ask out loud" that are decidable without a
 * browser, a microphone or a network.
 *
 * Everything here is a pure function of its arguments. That is not tidiness for
 * its own sake: the interesting logic in a voice feature is exactly the logic
 * that is painful to reach through a MediaRecorder and an audio element, so it
 * is kept out of both. The component and the two routes are left holding wiring.
 *
 * Three facts from the live probe (docs/ASSISTANT.md, 2026-08-27) shape this file:
 *
 *   1. **STT returns the detected language.** So the reply language is measured,
 *      not guessed off `navigator.language`. `normaliseLanguageCode` exists to
 *      turn that measurement into something the chat route and Bulbul both
 *      accept, and to say `null` — honestly — when it cannot.
 *   2. **Bulbul returns base64 WAV in JSON, not a stream.** A paragraph
 *      synthesised in one call is a long silence followed by audio. So the
 *      answer is cut at sentence boundaries here (`chunkForSpeech`) and the
 *      client plays clip *n* while fetching clip *n+1*. Time-to-first-sound
 *      becomes the cost of one sentence rather than one paragraph.
 *   3. **Not every language Saarika can hear, Bulbul can speak.** That gap is
 *      reported (`isSpeakable`), never papered over with a silent English
 *      substitution — being answered in the wrong language is worse than being
 *      told the answer is text-only.
 */

// ---------------------------------------------------------------------------
// ceilings
// ---------------------------------------------------------------------------

/**
 * Hard upload cap. Opus at the browser's default bitrate runs roughly 8-16 KB/s,
 * so 4 MB is minutes of speech — far above the duration cap below. It is the
 * backstop for a body that lies about its duration, not the working limit.
 */
export const MAX_AUDIO_BYTES = 4_000_000;

/** Below this a "recording" is a container header and nothing else. */
export const MIN_AUDIO_BYTES = 1_200;

/** A question, not a monologue. Also the ceiling on what one transcribe costs. */
export const MAX_RECORDING_MS = 30_000;

/** Shorter than this is a mis-tap, not an utterance. */
export const MIN_RECORDING_MS = 350;

/**
 * Longest text sent to Bulbul in one call. The API takes a single passage per
 * request; chunking below this keeps every call short enough to play back
 * before the next one is needed.
 */
export const TTS_MAX_CHARS = 450;

/**
 * Ceiling on clips spoken for one answer. A cited answer runs long; reading all
 * of it aloud is both a bill and a hostage situation. The full text stays on
 * screen, and the client says plainly where the speech stops.
 */
export const MAX_SPEECH_CHUNKS = 12;

/**
 * Above this, accuracy beats latency and the model changes. See `sttModelFor`.
 */
export const FLASH_MAX_MS = 15_000;

export type SttModel = "saarika:flash" | "saarika:v2.5";

/**
 * Which Saarika to send a clip to.
 *
 * `saaras:v3-realtime` is the streaming model, and this button is not a
 * streaming transport: it records while held, then uploads one file on release.
 * A realtime model over a one-shot multipart POST buys nothing and costs the
 * complexity of a session. So the choice is between the two one-shot models:
 *
 *   - `saarika:flash` for the short utterance the button is designed around
 *     ("How do I reach Kedarnath?"), where the round trip is what the user
 *     feels and a fraction of a second of accuracy is not.
 *   - `saarika:v2.5` past `FLASH_MAX_MS`, where the user has already invested
 *     fifteen seconds and a mis-transcription costs them the whole utterance.
 *
 * Both return `language_code`, which is the field the whole feature turns on.
 */
export const sttModelFor = (durationMs: number | null | undefined): SttModel =>
  typeof durationMs === "number" && durationMs > FLASH_MAX_MS ? "saarika:v2.5" : "saarika:flash";

// ---------------------------------------------------------------------------
// audio guards
// ---------------------------------------------------------------------------

/**
 * Containers MediaRecorder actually produces, plus the two the desktop world
 * uploads. Anything else is rejected before it reaches an API call: an
 * unrecognised container is either a broken recording or someone poking at the
 * endpoint, and both should cost nothing.
 */
export const ACCEPTED_AUDIO_TYPES: readonly string[] = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
];

export type AudioRejection =
  | "empty"
  | "too-short"
  | "too-large"
  | "too-long"
  | "unsupported-type";

export type AudioGuard =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: AudioRejection; readonly message: string };

/**
 * Wording note: these strings are shown to a pilgrim, not logged. Each says what
 * happened and what to do instead, in the fewest plain words that carry both.
 * None of them says "error", "invalid" or "failed".
 */
const REJECTIONS: Record<AudioRejection, string> = {
  empty: "Nothing was recorded. Hold the button while you speak, then let go.",
  "too-short": "That was too quick to hear. Hold the button while you speak, then let go.",
  "too-large": "That recording is too big to send. Please ask in a shorter sentence.",
  "too-long": `Recordings stop at ${MAX_RECORDING_MS / 1000} seconds. Please ask in a shorter sentence.`,
  "unsupported-type": "This browser recorded a sound file the atlas cannot read. You can type the question instead.",
};

/** `audio/webm;codecs=opus` -> `audio/webm`. Parameters are not part of the check. */
export const baseMimeType = (type: string | null | undefined): string =>
  (type ?? "").split(";")[0]!.trim().toLowerCase();

/**
 * One guard for both sides of the wire. The browser runs it before uploading so
 * a doomed clip never costs a request; the route runs it again on what actually
 * arrived, because the browser's copy is advice and the route's copy is the rule.
 */
export function guardAudio(input: {
  readonly size: number;
  readonly durationMs?: number | null;
  readonly type?: string | null;
}): AudioGuard {
  const reject = (code: AudioRejection): AudioGuard => ({ ok: false, code, message: REJECTIONS[code] });

  if (!Number.isFinite(input.size) || input.size <= 0) return reject("empty");
  if (input.size > MAX_AUDIO_BYTES) return reject("too-large");
  if (input.size < MIN_AUDIO_BYTES) return reject("too-short");

  const duration = input.durationMs;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    // A tolerance, not a second limit: the client stops itself at
    // MAX_RECORDING_MS and the last dataavailable event lands a beat later.
    if (duration > MAX_RECORDING_MS + 2_000) return reject("too-long");
    if (duration < MIN_RECORDING_MS) return reject("too-short");
  }

  const type = baseMimeType(input.type);
  if (type && !ACCEPTED_AUDIO_TYPES.includes(type)) return reject("unsupported-type");

  return { ok: true };
}

/**
 * The recording container, chosen from what this browser will admit to
 * supporting. Takes the predicate rather than reaching for `MediaRecorder` so
 * the preference order is testable in Node.
 *
 * Order is deliberate: `audio/mp4` first because Safari — the browser most of
 * this audience is holding — records AAC in MP4 and nothing else, then Opus in
 * the two containers Chrome and Firefox produce. `undefined` means "let the
 * browser pick", which is the correct MediaRecorder default and not a failure.
 */
export const RECORDING_MIME_PREFERENCE: readonly string[] = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

export function pickRecordingMime(isSupported: (type: string) => boolean): string | undefined {
  for (const candidate of RECORDING_MIME_PREFERENCE) {
    if (isSupported(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Filename for the multipart part. Sarvam reads the extension, so a `.wav` name
 * on an Opus body is a way to be told "unsupported" by an API that would
 * otherwise have coped.
 */
export function fileNameFor(type: string | null | undefined): string {
  const base = baseMimeType(type);
  const extension =
    base === "audio/mp4" || base === "audio/aac" || base === "audio/x-m4a" ? "m4a"
      : base === "audio/ogg" ? "ogg"
        : base === "audio/mpeg" ? "mp3"
          : base === "audio/wav" || base === "audio/x-wav" || base === "audio/wave" ? "wav"
            : "webm";
  return `question.${extension}`;
}

// ---------------------------------------------------------------------------
// languages
// ---------------------------------------------------------------------------

/**
 * Languages Bulbul speaks. Saarika hears more than this — Assamese, Kashmiri,
 * Sanskrit, Urdu and others — so a question can be understood in a language the
 * answer cannot be read back in. That case is reported, not hidden.
 */
export const SPEAKABLE_LANGUAGES: readonly string[] = [
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN",
  "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
];

/**
 * Endonym-free English labels, shown next to the transcript so a wrong
 * detection is visible before it becomes a wrong-language answer. A code the
 * table does not know is shown as the code itself rather than guessed at.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  "as-IN": "Assamese",
  "bn-IN": "Bengali",
  "brx-IN": "Bodo",
  "doi-IN": "Dogri",
  "en-IN": "English",
  "gu-IN": "Gujarati",
  "hi-IN": "Hindi",
  "kn-IN": "Kannada",
  "ks-IN": "Kashmiri",
  "kok-IN": "Konkani",
  "mai-IN": "Maithili",
  "ml-IN": "Malayalam",
  "mni-IN": "Manipuri",
  "mr-IN": "Marathi",
  "ne-IN": "Nepali",
  "od-IN": "Odia",
  "pa-IN": "Punjabi",
  "sa-IN": "Sanskrit",
  "sd-IN": "Sindhi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "ur-IN": "Urdu",
};

/**
 * Sarvam spells Odia `od-IN`. ISO 639-1 spells it `or`, which is what a browser
 * locale carries — so both arrive here and both must come out as the spelling
 * the API accepts.
 */
const CODE_ALIASES: Record<string, string> = { or: "od", ori: "od", ory: "od" };

const CODE_SHAPE = /^([a-z]{2,3})(?:[-_]([a-z]{2,4}))?$/i;

/**
 * Normalise a detected or supplied language tag to Sarvam's `xx-IN` form.
 *
 * Returns `null` for absent, `"unknown"` (which Saarika returns when it will not
 * commit) or anything not shaped like a language tag. `null` is a value the rest
 * of the feature handles — it means "reply in the script the question was asked
 * in", which is the honest fallback and the one the chat prompt already has.
 */
export function normaliseLanguageCode(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;

  const match = CODE_SHAPE.exec(trimmed);
  if (!match) return null;

  const language = CODE_ALIASES[match[1]!.toLowerCase()] ?? match[1]!.toLowerCase();
  // The region is always IN. Every tag Sarvam accepts is an Indian variant, so
  // an `en-GB` off a browser locale has to become `en-IN` or the call is
  // rejected for a difference that means nothing to either model.
  return `${language}-IN`;
}

export function languageLabel(code: string | null | undefined): string {
  const normalised = normaliseLanguageCode(code);
  if (!normalised) return "an unrecognised language";
  return LANGUAGE_NAMES[normalised] ?? normalised;
}

export const isSpeakable = (code: string | null | undefined): boolean => {
  const normalised = normaliseLanguageCode(code);
  return normalised !== null && SPEAKABLE_LANGUAGES.includes(normalised);
};

/**
 * The language to synthesise in: the detected one when Bulbul speaks it, and
 * `null` — meaning "do not speak, say why" — when it does not. Never silently
 * English: answering a Kashmiri question aloud in English is a worse failure
 * than not answering aloud at all.
 */
export const speechLanguage = (detected: string | null | undefined): string | null => {
  const normalised = normaliseLanguageCode(detected);
  return normalised && SPEAKABLE_LANGUAGES.includes(normalised) ? normalised : null;
};

// ---------------------------------------------------------------------------
// speech chunking
// ---------------------------------------------------------------------------

/**
 * Sentence boundaries, including the Devanagari danda and double danda. Splits
 * on a terminator followed by whitespace — not on a bare full stop, so "3.30
 * p.m." and "No. 4" survive intact.
 */
const SENTENCE_BREAK = /(?<=[.!?…।॥])\s+|\n+/;

/** Last whitespace at or before `limit`, or -1 when the run has none. */
const lastBreakBefore = (text: string, limit: number): number => {
  for (let i = Math.min(limit, text.length - 1); i > 0; i -= 1) {
    if (/\s/.test(text[i]!)) return i;
  }
  return -1;
};

const hardSplit = (piece: string, maxChars: number): string[] => {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > maxChars) {
    const cut = lastBreakBefore(rest, maxChars);
    const at = cut > 0 ? cut : maxChars;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
};

/**
 * Cut an answer into clips to synthesise, at sentence boundaries where they
 * exist and at a word boundary where they do not.
 *
 * This is the whole answer to "Bulbul returns base64 in JSON, not a stream":
 * the client asks for chunk 0, starts playing it, and fetches chunk 1 while it
 * plays. The user hears the first sentence in the time one sentence takes to
 * synthesise, rather than staring at a spinner for the paragraph.
 *
 * Guarantees, all asserted in the tests: no chunk is empty, no chunk exceeds
 * `maxChars`, and the chunks concatenate back to the input word for word.
 */
export function chunkForSpeech(text: string, maxChars: number = TTS_MAX_CHARS): string[] {
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (maxChars < 1) return [cleaned];

  const sentences = cleaned.split(SENTENCE_BREAK).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) { chunks.push(current); current = ""; }
      chunks.push(...hardSplit(sentence, maxChars));
      continue;
    }
    const joined = current ? `${current} ${sentence}` : sentence;
    if (joined.length > maxChars) {
      chunks.push(current);
      current = sentence;
      continue;
    }
    current = joined;
  }

  if (current) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// audio decoding
// ---------------------------------------------------------------------------

/**
 * Bulbul's base64 payload to something an <audio> element will play.
 *
 * Tolerates a data: URL prefix and the whitespace a JSON pretty-printer can
 * introduce, and throws a plain `Error` rather than letting `atob`'s
 * `InvalidCharacterError` reach a catch block that will show it to a user.
 */
export function base64ToBlob(base64: string, type: string = "audio/wav"): Blob {
  const payload = (base64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!payload) throw new Error("empty audio payload");

  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    throw new Error("audio payload was not base64");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ---------------------------------------------------------------------------
// rate limiting (shared by both voice routes)
// ---------------------------------------------------------------------------

/**
 * The pure half of a fixed-window limiter: given the hits already recorded for a
 * key, decide and return the NEW list. The caller owns the store, so this stays
 * a function of its arguments and never mutates the array it was handed.
 *
 * Same posture as `api/chat`: per instance, so not a security boundary on a
 * serverless fleet. It exists to stop one stuck tab from spending a budget.
 */
export function withinLimit(
  recent: readonly number[] | undefined,
  now: number,
  windowMs: number,
  max: number,
): { readonly allowed: boolean; readonly hits: readonly number[] } {
  const live = (recent ?? []).filter((at) => now - at < windowMs);
  if (live.length >= max) return { allowed: false, hits: live };
  return { allowed: true, hits: [...live, now] };
}

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------

/**
 * `7250 -> "0:07"`. The recording indicator must not rely on colour alone
 * (WCAG 1.4.1), so a climbing clock carries the state in text next to the dot.
 */
export function elapsedLabel(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.floor(safe / 1000);
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${String(seconds).padStart(2, "0")}`;
}
