/**
 * GET /api/agent/lookup?q=… — the cited corpus, shaped for a voice agent.
 *
 * WHY THIS EXISTS
 * ---------------
 * A Sarvam Voice Agent's prompt and knowledge base live in their dashboard, so
 * by default it answers from the model's own memory and nothing it says is
 * bound by CLAUDE.md rule 2. For an atlas whose entire claim is its sourcing,
 * that is the wrong default.
 *
 * Sarvam's harness can call custom tools. Pointed at this endpoint, the agent
 * stops recalling temples and starts looking them up: it asks, we answer from
 * data/sites.json, and it speaks what we returned. The citation guarantee comes
 * back — not because the model is trustworthy, but because the only facts it is
 * given are ones we can cite.
 *
 * SHAPED FOR SPEECH, NOT FOR A SCREEN
 * -----------------------------------
 * `/api/chat` returns prose with markdown and a citations array, which is right
 * for a panel and wrong for a voice agent: nobody wants asterisks or a URL read
 * aloud. This returns short plain-text facts and a `sourced` flag, and says
 * `found: false` rather than composing an apology — the agent has its own voice
 * for that, in the caller's own language.
 *
 * PUBLIC AND UNAUTHENTICATED, DELIBERATELY
 * ----------------------------------------
 * Sarvam's harness calls it from their infrastructure, so there is no shared
 * secret to check and an IP allowlist would be guesswork. That is acceptable
 * because the endpoint is strictly READ-ONLY over data that is already published
 * at /site/[slug] and in llms-full.txt — it exposes nothing a crawler cannot
 * already read. It is rate-limited so it cannot become a cheap way to scrape the
 * corpus faster than the sitemap allows.
 */

import { NextResponse } from "next/server";
import { SITES, type Site } from "@/lib/sites";
import { retrieve, type AtlasRecord } from "@/lib/ai/retrieve";

export const runtime = "nodejs";
/** Cached at the edge: the same question has the same answer until a deploy. */
export const revalidate = 3600;

const CORPUS = SITES as unknown as readonly (Site & AtlasRecord)[];
const MAX_QUERY = 120;
/** Three is what a spoken answer can hold. More is a list nobody can follow. */
const LIMIT = 3;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const hits = new Map<string, number[]>();

const clientIp = (r: Request): string =>
  r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

/**
 * One record as short spoken facts.
 *
 * `significance` is trimmed to its first sentence: the full paragraph is written
 * to be read, and read aloud it is a monologue. The agent gets enough to answer
 * and a pointer to where the rest lives.
 */
const speakable = (record: AtlasRecord) => {
  const firstSentence = (text?: string) =>
    text ? (/^(.*?[.!?])(\s|$)/.exec(text.trim())?.[1] ?? text.trim().slice(0, 220)) : undefined;

  return {
    name: record.name,
    where: [record.place, record.state, record.country].filter(Boolean).join(", "),
    tradition: record.tradition,
    deity: record.deity || undefined,
    built: record.builtDisplay || undefined,
    dynasty: record.dynasty || undefined,
    patron: record.patron || undefined,
    history: firstSentence(record.significance),
    // Legend is labelled, never merged with history (rule 3). The prompt tells
    // the agent to say which it is.
    legend: firstSentence(record.story),
    access: record.access || undefined,
    // Every fact above comes from these. The agent does not read them aloud,
    // but their presence is what makes the answer sourced.
    sources: record.sources.map((s) => s.l),
    page: `https://tirthaatlas.org/site/${record.id}`,
  };
};

/**
 * The lookup itself. Shared by GET and POST.
 *
 * Both exist because tool builders differ: Sarvam's Canvas takes a cURL and
 * maps its parts to agent parameters, and a JSON body parameterises far more
 * cleanly there than a query string does. GET stays because it is cacheable and
 * trivial to test by hand.
 */
async function lookup(request: Request, q: string): Promise<Response> {
  const now = Date.now();
  const ip = clientIp(request);
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  if (hits.size > 5000) hits.clear();
  hits.set(ip, [...recent, now]);

  const query = q.trim().slice(0, MAX_QUERY);
  if (!query) {
    return NextResponse.json({ found: false, reason: "no question given", records: [] });
  }

  const result = retrieve(CORPUS, query, {}, LIMIT);
  if (result.empty || result.records.length === 0) {
    // Not an error and not an apology. The agent is told, in its prompt, to say
    // this in the caller's own language and to offer nothing further.
    return NextResponse.json({
      found: false,
      reason: "no record in the atlas matches that",
      query,
      records: [],
    });
  }

  return NextResponse.json({
    found: true,
    query,
    total: result.total,
    /** True when every returned record was reached only by a spelling fold. */
    approximate: result.fuzzy,
    records: result.records.map(speakable),
  });
}

/** Body shape: {"q": "kedarnath"}. Anything else is treated as an empty question. */
export async function POST(request: Request): Promise<Response> {
  let q = "";
  try {
    const body: unknown = await request.json();
    const parsed = (body ?? {}) as { q?: unknown; query?: unknown; question?: unknown };
    // `query` and `question` are accepted too: a tool builder's generated body
    // rarely uses the name you expected, and refusing it would surface as an
    // agent that silently never finds anything.
    const raw = parsed.q ?? parsed.query ?? parsed.question;
    q = typeof raw === "string" ? raw : "";
  } catch {
    return NextResponse.json({ found: false, reason: "malformed request", records: [] }, { status: 400 });
  }
  return lookup(request, q);
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return lookup(request, q);
}
