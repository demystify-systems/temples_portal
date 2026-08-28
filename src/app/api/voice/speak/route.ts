/**
 * POST /api/voice/speak — one passage of an answer, spoken.
 *
 * The shape of this route is a direct consequence of a measured fact: **Bulbul
 * returns base64 WAV inside JSON, not a stream** (docs/ASSISTANT.md). There is
 * no first byte to play early. A whole paragraph sent in one call is one long
 * silence and then audio.
 *
 * So the unit here is a *clip*, not an answer. The client cuts the answer at
 * sentence boundaries (`chunkForSpeech`), asks for clip 0, starts playing it,
 * and fetches clip 1 while clip 0 plays. Time-to-first-sound becomes the cost of
 * one sentence. That also keeps this route small, cheap per call, and bounded:
 * one short passage, one synthesis, no loop that can run away.
 *
 * The language is the one Saarika *detected*, threaded through by the client —
 * not a browser locale, and never silently swapped for English. A passage in a
 * language Bulbul does not speak is refused with a plain sentence, because
 * being answered aloud in the wrong language is worse than being told the
 * answer is text-only.
 */

import { NextResponse } from "next/server";
import { textToSpeech, SarvamError } from "@/lib/ai/sarvam";
import { TTS_MAX_CHARS, languageLabel, speechLanguage, withinLimit } from "@/lib/ai/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
/**
 * Higher than the chat limit on purpose: one answer is several clips, and a
 * replay is several more. It still bounds a stuck client to about three spoken
 * answers a minute.
 */
const RATE_LIMIT_MAX_REQUESTS = 40;
const RATE_LIMIT_MAX_KEYS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Ceiling on one passage. The client chunks below this; a direct caller cannot. */
const MAX_TEXT_CHARS = TTS_MAX_CHARS + 50;

const UNAVAILABLE = "The spoken reply is unavailable right now. The full answer is above.";

const hits = new Map<string, readonly number[]>();

const clientIp = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";

const fail = (message: string, status: number): Response =>
  NextResponse.json({ error: message }, { status });

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return fail(UNAVAILABLE, 503);

  const ip = clientIp(request);
  const limit = withinLimit(hits.get(ip), Date.now(), RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
  if (hits.size > RATE_LIMIT_MAX_KEYS) hits.clear();
  hits.set(ip, limit.hits);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too much speech requested in a short time. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT_WINDOW_MS / 1000) } },
    );
  }

  let text = "";
  let requested: string | null = null;
  try {
    const body: unknown = await request.json();
    const parsed = (body ?? {}) as { text?: unknown; language?: unknown };
    text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    requested = typeof parsed.language === "string" ? parsed.language : null;
  } catch {
    return fail("Malformed request.", 400);
  }

  if (!text) return fail("Nothing to speak.", 400);
  if (text.length > MAX_TEXT_CHARS) {
    return fail(`Passages are spoken ${MAX_TEXT_CHARS} characters at a time.`, 413);
  }

  // `speechLanguage` returns null for a language Saarika can hear but Bulbul
  // cannot speak. That is reported as its own state, not degraded to English.
  const language = speechLanguage(requested);
  if (!language) {
    return NextResponse.json(
      {
        error: requested
          ? `The atlas cannot read answers aloud in ${languageLabel(requested)} yet. The full answer is above.`
          : "The atlas could not tell which language to speak in. The full answer is above.",
        unsupportedLanguage: true,
      },
      { status: 422 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // One voice for the whole atlas, set by env. Unset means Bulbul's default,
    // so a deployment that configures nothing sounds exactly as it did before.
    const audios = await textToSpeech({
      apiKey, text, languageCode: language,
      speaker: process.env.SARVAM_TTS_SPEAKER,
      signal: controller.signal,
    });
    if (audios.length === 0) return fail(UNAVAILABLE, 503);
    // Bulbul may return more than one clip for one passage; all of them are
    // returned in order and the client plays them back to back.
    return NextResponse.json({ audios, mime: "audio/wav", language });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return fail("That took too long to read aloud. The full answer is above.", 504);
    }
    if (error instanceof SarvamError) {
      console.error(`[voice/speak] sarvam ${error.status}: ${error.message}`);
    } else {
      console.error("[voice/speak] failed:", error);
    }
    return fail(UNAVAILABLE, 503);
  } finally {
    clearTimeout(timer);
  }
}
