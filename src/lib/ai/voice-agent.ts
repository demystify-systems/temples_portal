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
};

export const voiceAgentConfig = (): VoiceAgentConfig => ({
  apiKey: process.env.SARVAM_VOICE_AGENT_KEY ?? "",
  orgId: process.env.SARVAM_VOICE_AGENT_ORG_ID ?? "",
  workspaceId: process.env.SARVAM_VOICE_AGENT_WORKSPACE_ID ?? "",
  appId: process.env.SARVAM_VOICE_AGENT_APP_ID ?? "",
});

/**
 * All four or nothing.
 *
 * A partial configuration is worse than none: the panel would offer a spoken
 * conversation and then fail at the handshake, after the reader has already
 * pressed talk. Missing anything means the Speak tab quietly uses the cited
 * cascade instead.
 */
export const voiceAgentConfigured = (): boolean =>
  Object.values(voiceAgentConfig()).every((value) => value !== "");
