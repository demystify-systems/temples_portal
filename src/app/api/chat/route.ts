/**
 * POST /api/chat — "Ask the Atlas".
 *
 * Everything expensive or dangerous is bounded here, because this is the only
 * endpoint in the project that spends money and the only one that can put words
 * in the site's voice.
 *
 * The four guards, and why each exists:
 *
 *   - **Retrieval first, model second.** The corpus is searched before the
 *     model is called. Nothing retrieved means the answer is a refusal, and a
 *     refusal never needs a fluent model to compose it if the question was
 *     asked in English. That makes the commonest bad case free.
 *   - **Per-IP rate limit.** In-memory, per instance. Not a security boundary —
 *     a serverless fleet has many instances — but it is what stops one open tab
 *     with a loop in it from running up a bill.
 *   - **Hard token ceiling and a bounded tool loop.** A reasoning model that
 *     keeps calling tools is a model that keeps billing. Three rounds, then it
 *     answers with what it has.
 *   - **Fail closed.** Every failure path returns "assistant unavailable". None
 *     returns a model-composed apology, because composing one costs a call, and
 *     none falls back to answering unsourced.
 *
 * The key is read from `SARVAM_API_KEY` — server-side only. It must never be
 * `NEXT_PUBLIC_*`: that would inline it into the client bundle of a public repo.
 */

import { NextResponse } from "next/server";
import { SITES, type Site } from "@/lib/sites";
import { chat, translate, tokenFloorFor, SarvamError, type ChatMessage } from "@/lib/ai/sarvam";
import { retrieve, type AtlasRecord } from "@/lib/ai/retrieve";
import { TOOLS, executeTool } from "@/lib/ai/tools";
import { buildAnswer, refusalPayload } from "@/lib/ai/answer";
import { systemPrompt, userTurn, REFUSAL, MAX_QUESTION_CHARS } from "@/lib/ai/prompt";

export const runtime = "nodejs";
/** Never cached: it is a POST that spends money and reads an env var. */
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// ceilings
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 6;
/**
 * Ceiling on the budget handed to any single call. sarvam.ts sets its own floor
 * (reasoning eats a small budget before a visible character appears) and may
 * double this once on a truncated reply, so the real per-call worst case is
 * twice this figure. That is why the cumulative budget below exists as well.
 */
const MAX_TOKENS_PER_CALL = 3000;
/**
 * The hard ceiling. Completion tokens include the reasoning trace and are
 * billed, so this — not the per-call figure — is what bounds the cost of one
 * question. Reaching it stops the tool loop and makes the model answer with
 * what it already has.
 */
const TOKEN_BUDGET_PER_REQUEST = 12_000;
/** Tool rounds before the model must answer with what it has. */
const MAX_TOOL_ROUNDS = 3;
/** Whole-request wall clock, including retries inside sarvam.ts. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Records handed to the model on the first turn. */
const RETRIEVAL_LIMIT = 5;
/** Entries kept in the rate-limit map before the oldest are dropped. */
const RATE_LIMIT_MAX_KEYS = 5000;

/** Any script that is not Latin — the signal that retrieval needs translating. */
const NON_LATIN_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

const UNAVAILABLE = { error: "assistant unavailable" } as const;
const unavailable = (status = 503) => NextResponse.json(UNAVAILABLE, { status });

// ---------------------------------------------------------------------------
// rate limiting
// ---------------------------------------------------------------------------

/** ip -> timestamps within the current window. Per instance, deliberately. */
const hits = new Map<string, number[]>();

/**
 * Client IP from the proxy headers Vercel sets. Never trusted for anything but
 * bucketing — a spoofed header buys a fresh bucket, which is why the token
 * ceiling below exists independently of this.
 */
const clientIp = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";

const withinRateLimit = (ip: string, now: number): boolean => {
  // Cheap eviction: the map is bounded so a header-spoofing client cannot grow
  // it without limit.
  if (hits.size > RATE_LIMIT_MAX_KEYS) hits.clear();
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    hits.set(ip, recent);
    return false;
  }
  hits.set(ip, [...recent, now]);
  return true;
};

// ---------------------------------------------------------------------------
// the response
// ---------------------------------------------------------------------------
//
// Citations AND result cards are both shaped in `answer.ts`, from `cited` — the
// records the tools actually returned. Neither is ever derived from the model's
// text: a citation the model typed would be unverifiable, and a *link* the
// model typed would be an unverifiable citation that also navigates. See the
// header of answer.ts.

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

const CORPUS = SITES as unknown as readonly (Site & AtlasRecord)[];

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.SARVAM_API_KEY;
  // No key configured is an unavailable assistant, not a broken page. The rest
  // of the site is static and must keep working.
  if (!apiKey) return unavailable();

  if (!withinRateLimit(clientIp(request), Date.now())) {
    return NextResponse.json(
      { error: "Too many questions in a short time. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT_WINDOW_MS / 1000) } },
    );
  }

  let question = "";
  let language: string | undefined;
  try {
    const body: unknown = await request.json();
    const parsed = (body ?? {}) as { question?: unknown; language?: unknown };
    question = typeof parsed.question === "string" ? parsed.question.trim() : "";
    language = typeof parsed.language === "string" && parsed.language.trim()
      ? parsed.language.trim().slice(0, 40)
      : undefined;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `Please keep the question under ${MAX_QUESTION_CHARS} characters.` },
      { status: 413 },
    );
  }

  /**
   * Retrieval runs on English, whatever the question was asked in.
   *
   * The corpus is stored in Latin script. `retrieve` matches keywords against
   * it, so a question in Tamil or Devanagari shares no tokens with any record
   * and matches NOTHING — measured: "தஞ்சாவூர் பிரகதீஸ்வரர் கோயில் எங்கே
   * இருக்கிறது?" retrieved zero records and the assistant refused a question
   * about one of the most famous temples it holds.
   *
   * That made the whole multilingual feature hollow. The atlas could HEAR Tamil
   * and SPEAK Tamil and could not ANSWER in it, so every non-English question
   * got a fluent refusal — which is worse than an honest "English only",
   * because it reads as "we have no record of your temple".
   *
   * So the query is translated for RETRIEVAL only. Mayura returns
   * "Where is the Brihadeeswarar Temple in Thanjavur?" for the above, which the
   * keyword index and the Indic normaliser both handle. Three things are
   * deliberately NOT translated:
   *
   *   - the corpus, ever (rule 2: a translated fact is an uncited fact);
   *   - the question shown to the model, which stays in the asker's own words
   *     so the answer addresses what they actually said;
   *   - the answer, which is generated in the asker's language as before.
   *
   * A failed translation degrades to the original query rather than failing the
   * request: the worst case is the refusal we would have given anyway.
   */
  let retrievalQuery = question;
  if (NON_LATIN_SCRIPT.test(question)) {
    try {
      const english = await translate({
        apiKey, text: question, from: "auto", to: "en-IN",
      });
      if (english.trim()) retrievalQuery = english.trim();
    } catch (error) {
      console.warn("[chat] query translation failed, retrieving on the original:", error);
    }
  }

  const found = retrieve(CORPUS, retrievalQuery, {}, RETRIEVAL_LIMIT);

  // Nothing was really asked — a blank query, or nothing but function words.
  // That refuses for free; no model call can turn it into a sourced answer.
  //
  // NOT the same as `no-match`, where real terms were asked and a strict AND
  // simply did not satisfy them. Refusing that outright is what made the
  // assistant reject "How do I reach Kedarnath?" about a record it holds: the
  // keyword AND is defeated by phrasing, and pulling the entity out of a
  // sentence is exactly what the model is good at. So `no-match` falls through
  // WITH tools, and refuses only if findSites also comes back empty.
  const nothingAsked = found.reason === "blank-query" || found.reason === "no-terms";
  if (nothingAsked && !needsTranslatedRefusal(question, language)) {
    return NextResponse.json(refusalPayload(REFUSAL));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const maxTokens = Math.min(tokenFloorFor(question), MAX_TOKENS_PER_CALL);

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt({ records: found.records, language, total: found.total }) },
      { role: "user", content: userTurn(question) },
    ];
    const cited: AtlasRecord[] = [...found.records];
    let spent = 0;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const result = await chat({
        apiKey,
        messages,
        maxTokens,
        signal: controller.signal,
        // The final round is answer-only: offering tools there invites a call
        // whose result nothing would read.
        ...(nothingAsked || round === MAX_TOOL_ROUNDS ? {} : { tools: [...TOOLS] }),
      });

      spent += result.completionTokens;

      // Another tool round only if there is budget left for one. Out of budget,
      // the model answers from what it has or the request fails closed — it
      // never keeps looping on the bill.
      if (result.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS && spent < TOKEN_BUDGET_PER_REQUEST) {
        messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });
        for (const call of result.toolCalls) {
          const outcome = executeTool(call.function.name, call.function.arguments, CORPUS);
          cited.push(...outcome.cited);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(outcome.result),
          });
        }
        continue;
      }

      // Truncated by the reasoning trace even after sarvam.ts's retry: there is
      // no answer to render, and half a sourced answer is worse than none.
      if (!result.content) return unavailable();

      // `refused` is decided by what the TOOLS returned, not by the first
      // retrieval. A `no-match` question that findSites then answered has real
      // records behind it — keying the refusal off `found.empty` threw those
      // citations away and rendered a sourced answer as an unsourced one.
      const payload = buildAnswer({
        answer: result.content,
        cited,
        corpus: CORPUS,
        refusalText: REFUSAL,
      });
      if (payload.dropped.length > 0) {
        // Server-side only. A sentence naming a record no tool returned was
        // removed rather than shipped beside cards that contradict it.
        console.warn(`[chat] dropped unsupported claims: ${payload.dropped.join(", ")}`);
      }
      return NextResponse.json(payload);
    }

    return unavailable();
  } catch (error) {
    // Fail closed, and log server-side only: an upstream message can carry a
    // request id or a key fragment and must never reach the browser.
    if (error instanceof SarvamError) {
      console.error(`[chat] sarvam ${error.status}${error.requestId ? ` req=${error.requestId}` : ""}: ${error.message}`);
    } else {
      console.error("[chat] failed:", error);
    }
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a refusal is worth a model call to translate.
 *
 * Latin-script questions get the fixed English sentence for free. A question in
 * Devanagari, Tamil, Bengali and the rest deserves its refusal in that script —
 * that is one small, bounded call, and the alternative (an English wall of text
 * to someone who did not ask in English) is the kind of quiet exclusion the
 * multilingual design exists to avoid.
 */
function needsTranslatedRefusal(question: string, language?: string): boolean {
  if (NON_LATIN_SCRIPT.test(question)) return true;
  return Boolean(language && !/^en\b/i.test(language) && language.toLowerCase() !== "english");
}
