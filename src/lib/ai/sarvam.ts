/**
 * Sarvam AI adapter.
 *
 * Every quirk encoded here was measured against the live API on 2026-08-27, not
 * taken from documentation or memory. See docs/ASSISTANT.md for the probe results.
 *
 * The two that will silently break a naive integration:
 *
 *   1. `sarvam-105b` is a REASONING model. It emits `reasoning_content` before a
 *      single visible character of `content`. A small `max_tokens` is consumed
 *      entirely by reasoning and the call returns `content: null` with
 *      `finish_reason: "length"` — which looks exactly like a refusal but is not.
 *      A Tamil prompt at max_tokens 600 came back empty this way. Indic reasoning
 *      traces run long.
 *
 *   2. Auth is the `api-subscription-key` header, NOT `Authorization: Bearer`.
 */

const BASE = "https://api.sarvam.ai";

/** Verified live. `sarvam-m` is deprecated and returns an error naming these. */
export const CHAT_MODELS = ["sarvam-105b-conversations", "sarvam-105b"] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];

/**
 * The model every call uses unless one is named.
 *
 * `sarvam-105b-conversations`, NOT `sarvam-105b`. Both were re-probed against
 * the live API on 2026-08-28 with this project's own prompts. `sarvam-105b` is a
 * REASONING model: it emits a long `reasoning_content` trace before a single
 * visible character, and that trace is billed as completion tokens. Measured, on
 * one identical corpus-grounded question:
 *
 *                              105b        conversations
 *   simple lookup              595 tok       8 tok
 *   refusal (out of corpus)    483 tok      13 tok
 *   refusal (bait: priest's
 *     phone number)            626 tok      13 tok
 *   dated answer             1,182 tok      52 tok
 *   Tamil question             362 tok      35 tok
 *   tool call                   73 tok      18 tok
 *   ------------------------------------------------
 *   TOTAL                    3,321 tok     139 tok      24x
 *
 * The answers were identical or better — the Tamil reply was fuller — and the
 * safety behaviour was unchanged: both refused "What is the capital of France?"
 * and both refused to invent a priest's phone number. 99% of what the reasoning
 * model billed was a trace no user ever sees.
 *
 * The switch also deletes a whole class of bug. Every "reasoning ate the budget"
 * workaround below — the token floors, the truncated/retry path — existed
 * because `sarvam-105b` returns `content: null` with `finish_reason: "length"`
 * when max_tokens is spent on reasoning. With no trace, that does not happen.
 * The workarounds are kept as a safety net, not as the normal path.
 */
import { mergeToolCallDeltas, type ToolCallAccumulator } from "./stream.ts";

export const DEFAULT_CHAT_MODEL: ChatModel = "sarvam-105b-conversations";

/** True for models that emit a billed `reasoning_content` trace before answering. */
export const isReasoningModel = (model: ChatModel): boolean => model === "sarvam-105b";

/**
 * Floor for any user-facing answer.
 *
 * `max_tokens` is a CEILING, not a charge — you are billed for what is actually
 * generated — so a generous floor costs nothing on the conversations model and
 * only protects a long answer from being cut mid-sentence. It stays high for
 * that reason, and because it is the safety net if a caller ever names the
 * reasoning model explicitly.
 */
export const MIN_ANSWER_TOKENS = 1500;
export const MIN_ANSWER_TOKENS_INDIC = 2500;

/** Scripts whose reasoning traces measured materially longer than Latin. */
const INDIC_SCRIPT = /[ऀ-෿฀-๿]/;

export const tokenFloorFor = (text: string): number =>
  INDIC_SCRIPT.test(text) ? MIN_ANSWER_TOKENS_INDIC : MIN_ANSWER_TOKENS;

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatResult = {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  /** Includes reasoning tokens — they are billed, so cost tracking must use this. */
  completionTokens: number;
  truncated: boolean;
};

export class SarvamError extends Error {
  // Declared explicitly rather than as constructor parameter properties: Node's
  // strip-only type stripping (which runs the test suite) rejects those.
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "SarvamError";
    this.status = status;
    this.requestId = requestId;
  }
}

const headers = (key: string) => ({
  "api-subscription-key": key,
  "Content-Type": "application/json",
});

/**
 * One chat turn. Retries once with a doubled budget when reasoning consumed the
 * whole allowance — that is a budget problem, never an answer.
 */
export async function chat(opts: {
  apiKey: string;
  messages: ChatMessage[];
  model?: ChatModel;
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Internal: guards the single retry. */
  _isRetry?: boolean;
}): Promise<ChatResult> {
  const {
    apiKey, messages, model = DEFAULT_CHAT_MODEL, tools,
    maxTokens = MIN_ANSWER_TOKENS, temperature = 0.2, signal,
  } = opts;

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    signal,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...(tools?.length ? { tools } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let message = body.slice(0, 300);
    let requestId: string | undefined;
    try {
      const parsed = JSON.parse(body);
      message = parsed?.error?.message ?? message;
      requestId = parsed?.error?.request_id;
    } catch { /* keep the raw body */ }
    throw new SarvamError(message, res.status, requestId);
  }

  const json = await res.json();
  const choice = json?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const finishReason: string = choice.finish_reason ?? "unknown";
  const content: string | null = message.content ?? null;
  const toolCalls: ToolCall[] = message.tool_calls ?? [];
  const truncated = finishReason === "length" && !content && toolCalls.length === 0;

  // Reasoning ate the budget. Retry once, bigger. Never render this as an answer.
  if (truncated && !opts._isRetry) {
    return chat({ ...opts, maxTokens: Math.min(maxTokens * 2, 8000), _isRetry: true });
  }

  return {
    content,
    toolCalls,
    finishReason,
    completionTokens: json?.usage?.completion_tokens ?? 0,
    truncated,
  };
}

/** Bulbul. Returns base64 WAV clips — this is JSON, not a stream. */
/**
 * Voices Bulbul will synthesise, enumerated by the API itself.
 *
 * Not copied from the documentation — read off the live API on 2026-08-28 by
 * sending a deliberately invalid speaker, which answers with the complete list
 * for the calling key. That is worth doing rather than trusting a docs page:
 * the list is what the key can actually use, and it is validated server-side.
 *
 * ON VOICE CLONING. A cloned voice CANNOT be used here today. Four checks agree:
 * this list holds only stock voices and no custom one; an unrecognised
 * `speaker` is rejected with the list above, so the field is a closed enum;
 * `voice_id`, `speaker_id`, `custom_speaker` and `clone_id` are all accepted
 * without error and silently discarded, which is how an API treats an unknown
 * field rather than a real one; and every plausible clone endpoint —
 * /voice-clone, /v1/voice-clone, /voice-library, /speaker/clone — answers 404,
 * not 401 or 400, so the route does not exist. The official reference documents
 * seven endpoints and none of them is voice cloning.
 *
 * If Sarvam exposes it, it will almost certainly arrive as an id accepted in
 * THIS field, which is why `speaker` is a plain string on the wire and the
 * allow-list is checked separately. The day it lands, this is an env var and a
 * new entry in KNOWN_SPEAKERS — not a refactor.
 */
export const KNOWN_SPEAKERS: readonly string[] = [
  // bulbul:v3
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran",
  "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun", "manan", "sumit",
  "roopa", "kabir", "aayan", "ashutosh", "advait", "anand", "tanya", "tarun",
  "sunny", "mani", "gokul", "vijay", "shruti", "suhani", "mohit", "kavitha",
  "rehan", "soham", "rupali",
  // bulbul:v2 only
  "anushka", "abhilash", "manisha", "vidya", "arya", "karun", "hitesh",
];

/** Bulbul's own default, used when none is configured. */
export const DEFAULT_SPEAKER = "shubh";

/**
 * The configured voice, or the default.
 *
 * An unrecognised name falls back rather than throwing. A typo in an env var
 * must not take the spoken answer offline for every visitor — a wrong-sounding
 * voice is a far smaller failure than no voice, and the mismatch is logged
 * where an operator will see it.
 */
export function resolveSpeaker(configured?: string | null): string {
  const wanted = (configured ?? "").trim().toLowerCase();
  if (!wanted) return DEFAULT_SPEAKER;
  if (KNOWN_SPEAKERS.includes(wanted)) return wanted;
  console.warn(
    `[sarvam] SARVAM_TTS_SPEAKER="${configured}" is not a voice Bulbul offers; using "${DEFAULT_SPEAKER}". ` +
    `Known voices: ${KNOWN_SPEAKERS.join(", ")}`,
  );
  return DEFAULT_SPEAKER;
}

export async function textToSpeech(opts: {
  apiKey: string;
  text: string;
  languageCode: string;
  /** A name from KNOWN_SPEAKERS. Absent means Bulbul's default. */
  speaker?: string | null;
  signal?: AbortSignal;
}): Promise<string[]> {
  const speaker = resolveSpeaker(opts.speaker);
  const res = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: headers(opts.apiKey),
    signal: opts.signal,
    body: JSON.stringify({
      text: opts.text,
      target_language_code: opts.languageCode,
      speaker,
    }),
  });
  if (!res.ok) throw new SarvamError(await res.text(), res.status);
  const json = await res.json();
  return json?.audios ?? [];
}

/**
 * Saarika/Saaras. Returns the transcript AND the DETECTED language — that second
 * field is what lets the assistant reply in the asker's language as a measured
 * value rather than a guess off the browser locale.
 */
export async function speechToText(opts: {
  apiKey: string;
  audio: Blob;
  model?: "saaras:v4" | "saaras:v3" | "saaras:v3-realtime";
  /**
   * The language the speaker SAID they would use, when they chose one.
   *
   * A hint, not a constraint: Saarika still returns the language it actually
   * heard, and someone who picked Tamil and then asked in English is still
   * understood. It matters most on the short utterances a detector is worst at
   * — "Kedarnath?" gives it very little to commit on — which is exactly when a
   * mis-detection costs the whole question.
   */
  languageCode?: string | null;
  signal?: AbortSignal;
}): Promise<{ transcript: string; languageCode: string | null; confidence: number | null }> {
  const form = new FormData();
  form.append("file", opts.audio, "audio.wav");
  form.append("model", opts.model ?? "saaras:v4");
  if (opts.languageCode) form.append("language_code", opts.languageCode);

  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": opts.apiKey }, // no Content-Type: FormData sets its own boundary
    signal: opts.signal,
    body: form,
  });
  if (!res.ok) throw new SarvamError(await res.text(), res.status);
  const json = await res.json();
  return {
    transcript: json?.transcript ?? "",
    languageCode: json?.language_code ?? null,
    confidence: json?.language_probability ?? null,
  };
}

/** Mayura. Used only to normalise a QUERY for retrieval — never to translate the corpus. */
export async function translate(opts: {
  apiKey: string;
  text: string;
  from: string;
  to: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${BASE}/translate`, {
    method: "POST",
    headers: headers(opts.apiKey),
    signal: opts.signal,
    body: JSON.stringify({
      input: opts.text,
      source_language_code: opts.from,
      target_language_code: opts.to,
    }),
  });
  if (!res.ok) throw new SarvamError(await res.text(), res.status);
  const json = await res.json();
  return json?.translated_text ?? "";
}

/** What a streamed completion emits: prose as it is written, then any calls. */
export type StreamEvent =
  | { readonly kind: "content"; readonly text: string }
  | { readonly kind: "tool_calls"; readonly calls: readonly ToolCall[] };

/**
 * The same completion, delivered as it is written.
 *
 * Tool calls stream too, so this handles both: the model may answer directly,
 * or it may open one or more calls first. Content is yielded as it arrives;
 * assembled calls are yielded once at the end, because a call's arguments are
 * JSON fragments that mean nothing until the last one lands.
 *
 * Sarvam's completions endpoint is OpenAI-shaped, so this is `stream: true`
 * over `choices[0].delta`, terminated by `[DONE]`.
 */
export async function* chatStream(opts: {
  apiKey: string;
  messages: ChatMessage[];
  model?: ChatModel;
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent, void, unknown> {
  const {
    apiKey, messages, model = DEFAULT_CHAT_MODEL, tools,
    maxTokens = MIN_ANSWER_TOKENS, temperature = 0.2, signal,
  } = opts;

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    signal,
    body: JSON.stringify({
      model, messages, max_tokens: maxTokens, temperature, stream: true,
      ...(tools?.length ? { tools } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    let message = body.slice(0, 300);
    let requestId: string | undefined;
    try {
      const parsed = JSON.parse(body);
      message = parsed?.error?.message ?? message;
      requestId = parsed?.error?.request_id;
    } catch { /* keep the raw body */ }
    throw new SarvamError(message || "no stream body", res.status, requestId);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // Frames split anywhere, including mid-multibyte and mid-JSON, so the tail is
  // carried rather than parsed.
  let buffer = "";
  let calls: ToolCallAccumulator = {};

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let cut: number;
      while ((cut = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          const assembled = Object.values(calls);
          if (assembled.length > 0) yield { kind: "tool_calls", calls: assembled as ToolCall[] };
          return;
        }

        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta;
          if (typeof delta?.content === "string" && delta.content.length > 0) {
            yield { kind: "content", text: delta.content };
          }
          calls = mergeToolCallDeltas(calls, delta?.tool_calls);
        } catch {
          // One unparseable frame is skipped rather than thrown: it must not
          // lose an answer that is otherwise arriving fine.
        }
      }
    }

    const assembled = Object.values(calls);
    if (assembled.length > 0) yield { kind: "tool_calls", calls: assembled as ToolCall[] };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
