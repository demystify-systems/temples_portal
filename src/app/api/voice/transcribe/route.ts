/**
 * POST /api/voice/transcribe — audio in, transcript + detected language out.
 *
 * Same posture as `api/chat`, for the same reasons: this endpoint spends money,
 * accepts an unbounded body from anyone, and is the first hop of an answer that
 * will be spoken in the site's voice. So it is bounded before it is useful.
 *
 *   - **Bounded body.** `Content-Length` is checked before the multipart is
 *     parsed, so a 500 MB upload is refused without ever being buffered. The
 *     parsed file is then checked again with the same guard the browser used —
 *     the browser's copy is advice, this one is the rule.
 *   - **Per-IP rate limit.** In-memory, per instance. Not a security boundary
 *     on a serverless fleet; it is what stops one stuck tab holding the button
 *     from running up a transcription bill.
 *   - **Fail closed, plainly.** Every failure returns one short sentence a
 *     pilgrim can act on. Upstream messages are logged server-side only: a
 *     Sarvam error body can carry a request id or a key fragment.
 *
 * What it deliberately does NOT do: answer anything. The transcript goes back to
 * the browser and is shown to the user *before* it is asked. A mis-transcription
 * that goes straight to an answer is indistinguishable from the assistant
 * misunderstanding the question, and this audience cannot tell those apart.
 */

import { NextResponse } from "next/server";
import { speechToText, SarvamError } from "@/lib/ai/sarvam";
import {
  MAX_AUDIO_BYTES,
  fileNameFor,
  guardAudio,
  isSpeakable,
  languageLabel,
  normaliseLanguageCode,
  sttModelFor,
  withinLimit,
} from "@/lib/ai/voice";

export const runtime = "nodejs";
/** Never cached: a POST that spends money and reads an env var. */
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
/** Roughly one held question every six seconds. Above that is a stuck button. */
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_MAX_KEYS = 5_000;
/** Whole-request wall clock. A transcription that slow has already failed. */
const REQUEST_TIMEOUT_MS = 20_000;

const UNAVAILABLE = "Voice input is unavailable right now. You can type the question instead.";

const hits = new Map<string, readonly number[]>();

const clientIp = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";

const fail = (message: string, status: number): Response =>
  NextResponse.json({ error: message }, { status });

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.SARVAM_API_KEY;
  // No key is an unavailable feature, not a broken page. The button is not
  // rendered in that deployment either (layout.tsx gates the whole assistant),
  // so reaching here means a direct call — which still gets a civil answer.
  if (!apiKey) return fail(UNAVAILABLE, 503);

  const ip = clientIp(request);
  const limit = withinLimit(hits.get(ip), Date.now(), RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
  if (hits.size > RATE_LIMIT_MAX_KEYS) hits.clear();
  hits.set(ip, limit.hits);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many recordings in a short time. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT_WINDOW_MS / 1000) } },
    );
  }

  // Declared size first: refusing here means the body is never buffered.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    return fail("That recording is too big to send. Please ask in a shorter sentence.", 413);
  }

  let audio: File | null = null;
  let durationMs: number | null = null;
  let chosenLanguage: string | null = null;
  try {
    const form = await request.formData();
    const field = form.get("audio");
    audio = field instanceof File ? field : null;
    const rawDuration = form.get("durationMs");
    const parsed = typeof rawDuration === "string" ? Number(rawDuration) : Number.NaN;
    durationMs = Number.isFinite(parsed) ? parsed : null;
    // Normalised here rather than trusted: this arrives from the browser, and a
    // malformed tag is a 400 from Sarvam for a reason the user cannot act on.
    const rawLanguage = form.get("language");
    chosenLanguage = typeof rawLanguage === "string" ? normaliseLanguageCode(rawLanguage) : null;
  } catch {
    return fail("That recording could not be read. Please try again.", 400);
  }

  if (!audio) return fail("No recording was received. Please try again.", 400);

  // The same guard the browser ran, on what actually arrived. The duration is a
  // client-reported hint and is treated as one; the byte count is measured here.
  const guard = guardAudio({ size: audio.size, durationMs, type: audio.type });
  if (!guard.ok) return fail(guard.message, guard.code === "too-large" ? 413 : 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Re-wrapped rather than forwarded as-is: Sarvam reads the filename
    // extension, and a `blob` with no extension is a rejection for a reason
    // that has nothing to do with the audio.
    const named = new File([await audio.arrayBuffer()], fileNameFor(audio.type), {
      type: audio.type || "audio/webm",
    });

    const result = await speechToText({
      apiKey,
      audio: named,
      model: sttModelFor(durationMs),
      languageCode: chosenLanguage,
      signal: controller.signal,
    });

    const transcript = result.transcript.trim();
    if (!transcript) {
      // Not an error: silence, or a room too loud to hear over. Saying so is
      // more use than "transcription failed".
      return NextResponse.json(
        { transcript: "", language: null, languageLabel: null, speakable: false,
          note: "Nothing could be made out. Try again a little closer to the microphone." },
      );
    }

    // The measured language — the field this whole feature turns on. It is
    // reported as a code AND a human label so a wrong detection is visible to
    // the user before it becomes a wrong-language answer.
    const language = normaliseLanguageCode(result.languageCode);

    return NextResponse.json({
      transcript,
      language,
      languageLabel: language ? languageLabel(language) : null,
      confidence: result.confidence,
      speakable: isSpeakable(language),
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return fail("That took too long to transcribe. Please try again.", 504);
    }
    if (error instanceof SarvamError) {
      console.error(`[voice/transcribe] sarvam ${error.status}: ${error.message}`);
    } else {
      console.error("[voice/transcribe] failed:", error);
    }
    return fail(UNAVAILABLE, 503);
  } finally {
    clearTimeout(timer);
  }
}
