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
export const CHAT_MODELS = ["sarvam-105b", "sarvam-105b-conversations"] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];

/**
 * Floor for any user-facing answer. Below roughly this, reasoning eats the whole
 * budget and `content` comes back null. Indic scripts need the higher figure.
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
    apiKey, messages, model = "sarvam-105b", tools,
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
export async function textToSpeech(opts: {
  apiKey: string;
  text: string;
  languageCode: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const res = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: headers(opts.apiKey),
    signal: opts.signal,
    body: JSON.stringify({ text: opts.text, target_language_code: opts.languageCode }),
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
  model?: "saarika:v2.5" | "saarika:flash" | "saaras:v3" | "saaras:v3-realtime" | "saaras:v4";
  signal?: AbortSignal;
}): Promise<{ transcript: string; languageCode: string | null; confidence: number | null }> {
  const form = new FormData();
  form.append("file", opts.audio, "audio.wav");
  form.append("model", opts.model ?? "saarika:v2.5");

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
