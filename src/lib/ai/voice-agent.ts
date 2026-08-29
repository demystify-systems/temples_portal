/**
 * Voice Agents configuration, read from the environment.
 *
 * A module rather than an export from the route, because a Next.js route file
 * may only export request handlers and a small set of config constants —
 * anything else fails the build with "does not match the required types of a
 * Next.js Route". Two routes need these values, so they live here.
 *
 * SERVER ONLY. The key must never reach a browser bundle; only `orgId`,
 * `workspaceId` and `appId` are ever sent to the client, and those are
 * identifiers rather than credentials.
 */

export type VoiceAgentConfig = {
  readonly apiKey: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly appId: string;
  /**
   * Which published version of the agent to open.
   *
   * Not optional in practice, though the SDK types it so. `app-runtime` cannot
   * resolve an app without it and answers 404 "App not found for the
   * interaction type" — wording that points at `interaction_type`, which is
   * present and correct, and says nothing about the parameter actually missing.
   * Verified against the live service on 2026-08-28:
   *
   *   ?interaction_type=call            -> 404
   *   ?interaction_type=call&version=1  -> 200
   */
  readonly version: number | null;
};

/**
 * Unset means "whatever is published", which is what we want by default: the
 * handshake resolves the live version itself, so a publish takes effect without
 * a redeploy. Pin a number only to hold an agent on an older version.
 */
const parseVersion = (raw: string | undefined): number | null => {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const voiceAgentConfig = (): VoiceAgentConfig => ({
  apiKey: process.env.SARVAM_VOICE_AGENT_KEY ?? "",
  orgId: process.env.SARVAM_VOICE_AGENT_ORG_ID ?? "",
  workspaceId: process.env.SARVAM_VOICE_AGENT_WORKSPACE_ID ?? "",
  appId: process.env.SARVAM_VOICE_AGENT_APP_ID ?? "",
  // Defaulted, not required: every agent has a version 1, and a deployment
  // that has never heard of this variable should still open a call. Anything
  // that is not a positive integer falls back rather than reaching the SDK,
  // where a NaN would be dropped as falsy and reproduce the original 404.
  version: parseVersion(process.env.SARVAM_VOICE_AGENT_VERSION),
});

/**
 * All four or nothing.
 *
 * A partial configuration is worse than none: the panel would offer a spoken
 * conversation and then fail at the handshake, after the reader has already
 * pressed talk. Missing anything means the Speak tab quietly uses the cited
 * cascade instead.
 */
export const voiceAgentConfigured = (): boolean => {
  const { apiKey, orgId, workspaceId, appId } = voiceAgentConfig();
  // `version` is deliberately not part of this: it always has a value, so
  // including it would make the check look stricter than it is.
  return [apiKey, orgId, workspaceId, appId].every((value) => value !== "");
};
