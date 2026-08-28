/**
 * GET /api/search?q=… — transliteration-tolerant search, from Postgres.
 *
 * The site already has a search: a bundled index matched by substring in the
 * browser. It is fast, it works offline, and it cannot do the one thing this
 * corpus most needs — find a temple you have spelled a different way.
 *
 * There is no single correct romanisation of these names. Brihadisvara,
 * Brihadeeswarar, Brihadeeshwara and Bṛhadīśvara are one temple; Meenakshi,
 * Minakshi and Mīnākṣī are one goddess. A visitor cannot know which spelling we
 * stored, and substring matching answers "nothing found" for three of those
 * four. `search_sites()` (migrations 0006 and 0007) blends weighted full text,
 * cited aliases and trigram similarity over a transliteration-normalised name,
 * and resolves 17 of 18 measured variants.
 *
 * DEGRADATION IS THE CONTRACT, NOT A COURTESY
 * -------------------------------------------
 * This route is an ENHANCEMENT over the client index, never a replacement for
 * it. Constitution rule 6: the corpus is canonical and the site must build and
 * serve with no database at all. So with the env vars unset this returns 503
 * with `fallback: "client"`, and the caller is expected to keep using the index
 * it already has. Nothing here is on the critical path of any page.
 *
 * That also makes it safe offline: a service worker that never intercepts
 * /api/* means this simply fails, and the client index answers instead.
 */

import { NextResponse } from "next/server";
import { sbRest, supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Cached at the edge. A search for "kedarnath" returns the same rows for
 * everybody until the corpus changes, and the corpus changes on deploy — so a
 * generous TTL costs nothing and takes the per-keystroke load off Postgres.
 */
export const revalidate = 3600;

/** Longest query accepted. Anything longer is not a temple name. */
const MAX_QUERY_CHARS = 120;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

export type SearchHit = {
  readonly id: string;
  readonly name: string;
  readonly place: string;
  readonly state: string | null;
  readonly country: string;
  readonly tradition: string;
  readonly tier: string;
  readonly lat: number;
  readonly lng: number;
  readonly rank: number;
  /**
   * How this row was found. Surfaced to the caller ON PURPOSE: a 0.35-similarity
   * guess must not be presented with the same confidence as an exact hit, and
   * the UI cannot make that distinction if the API hides it.
   */
  readonly match: "exact" | "alias" | "fuzzy";
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_CHARS);
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (!q) return NextResponse.json({ query: "", hits: [] as SearchHit[] });

  // Not an error state. A deployment with no database is a supported one, and
  // the caller has a working index of its own to fall back to.
  if (!supabaseConfigured()) {
    return NextResponse.json(
      { query: q, hits: [], fallback: "client", reason: "no database configured" },
      { status: 503 },
    );
  }

  try {
    const hits = await sbRest<SearchHit[]>("rpc/search_sites", {
      method: "POST",
      body: JSON.stringify({ q, in_limit: limit }),
    });
    return NextResponse.json({ query: q, hits });
  } catch (error) {
    // Logged server-side only: a PostgREST error body names schemas, functions
    // and sometimes the failing SQL, none of which belongs in a browser.
    console.error("[search] search_sites failed:", error);
    return NextResponse.json(
      { query: q, hits: [], fallback: "client", reason: "search unavailable" },
      { status: 503 },
    );
  }
}
