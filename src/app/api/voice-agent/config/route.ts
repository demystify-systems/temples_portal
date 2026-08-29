/**
 * GET /api/voice-agent/config — the non-secret half of the Voice Agents setup.
 *
 * The SDK needs `org_id`, `workspace_id` and `app_id` in the browser to build
 * its handshake request. Those are identifiers, not credentials: they name which
 * agent to talk to, and the handshake that turns them into a live socket is
 * authenticated by the key, server-side, in ../[...path]/route.ts.
 *
 * The key itself is never in this response. That separation is the whole design:
 * the browser learns WHICH agent, the server proves it MAY.
 */

import { NextResponse } from "next/server";
import { voiceAgentConfig, voiceAgentConfigured } from "@/lib/ai/voice-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!voiceAgentConfigured()) {
    // A deployment without Voice Agents is supported and normal. The client
    // shows the cited cascade instead, so this is a state, not a failure.
    return NextResponse.json({ configured: false }, { status: 200 });
  }
  const { orgId, workspaceId, appId, version } = voiceAgentConfig();
  return NextResponse.json(
    { configured: true, orgId, workspaceId, appId, version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
