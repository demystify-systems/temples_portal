/**
 * Proxy for Sarvam Voice Agents' signed-URL handshake.
 *
 * WHY THIS EXISTS
 * ---------------
 * `sarvam-conv-ai-sdk` takes an `apiKey` and, from the browser, calls
 * `GET {baseUrl}orgs/{org}/workspaces/{ws}/apps/{app}/url` with an `X-API-Key`
 * header to obtain a time-limited signed WebSocket URL. Doing that literally
 * would ship a Voice Agents key to every visitor of a public site — the SDK's
 * own documentation warns against it.
 *
 * So the SDK is pointed at `/api/voice-agent/` instead (its `baseUrl` option),
 * and this route performs the same handshake server-side with the real key. The
 * browser receives only the signed URL, which is short-lived and scoped to one
 * conversation. The key never leaves the server.
 *
 * WHAT THIS ROUTE DOES NOT DO
 * ---------------------------
 * It does not proxy the WebSocket itself. Once the browser has the signed URL it
 * talks to Sarvam directly, which is the point: audio never transits our
 * infrastructure, and a serverless function is the wrong shape for holding a
 * long-lived bidirectional audio socket anyway.
 *
 * A NOTE ON WHAT THIS PATH ANSWERS FROM
 * -------------------------------------
 * A Voice Agent's prompt, tools and knowledge base are authored in Sarvam's
 * dashboard, not here. Answers on this path therefore do NOT come from
 * data/sites.json and are NOT bound by the citation rule the rest of the atlas
 * enforces (CLAUDE.md rule 2). The typed assistant and the fallback voice
 * cascade both still answer only from cited records; this one is a different
 * contract, and the UI says so.
 */

import { NextResponse } from "next/server";
import { voiceAgentConfig } from "@/lib/ai/voice-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://apps.sarvam.ai/api/app-runtime/";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { apiKey } = voiceAgentConfig();
  if (!apiKey) {
    // Not an error: a deployment without Voice Agents is supported, and the
    // client falls back to the cited cascade.
    return NextResponse.json({ error: "voice agent not configured" }, { status: 503 });
  }

  const { path } = await params;
  const segments = path ?? [];

  /**
   * Only the handshake is proxied. Without this the route is an open relay to
   * any path under apps.sarvam.ai, authenticated with our key — a
   * confused-deputy hole that a URL is enough to exploit.
   */
  const shape = /^orgs\/[\w-]+\/workspaces\/[\w-]+\/apps\/[\w-]+\/url$/;
  const joined = segments.join("/");
  if (!shape.test(joined)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(UPSTREAM + joined);
  // Forward the SDK's own query parameters (sample rates, user identifier).
  for (const [k, v] of new URL(request.url).searchParams) url.searchParams.set(k, v);

  try {
    const upstream = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      // A handshake that slow has already lost the conversation.
      signal: AbortSignal.timeout(10_000),
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      // Logged server-side only: an upstream body can name the org, the app and
      // occasionally part of the key.
      console.error(`[voice-agent] handshake ${upstream.status}: ${body.slice(0, 200)}`);
      return NextResponse.json({ error: "voice agent unavailable" }, { status: 502 });
    }
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[voice-agent] handshake failed:", error);
    return NextResponse.json({ error: "voice agent unavailable" }, { status: 502 });
  }
}
