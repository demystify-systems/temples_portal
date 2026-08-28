// Verify Voice Agents credentials BEFORE deploying them.
//
//   node scripts/check-voice-agent.mjs
//
// Reads the four SARVAM_VOICE_AGENT_* variables from the environment (or
// .env.local) and performs the real signed-URL handshake against Sarvam. It
// tells you which value is wrong rather than leaving you to infer it from a
// call that fails after someone has pressed talk.
//
// Nothing is written and no conversation is started: this is the handshake
// only, which is a plain GET.

import { readFileSync, existsSync } from "node:fs";

const UPSTREAM = "https://apps.sarvam.ai/api/app-runtime";

/** .env.local is gitignored and is where these live during development. */
const loadEnvLocal = () => {
  for (const path of [".env.local", "../.env.local"]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z_0-9]*)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
};
loadEnvLocal();

const need = {
  SARVAM_VOICE_AGENT_KEY: process.env.SARVAM_VOICE_AGENT_KEY,
  SARVAM_VOICE_AGENT_ORG_ID: process.env.SARVAM_VOICE_AGENT_ORG_ID,
  SARVAM_VOICE_AGENT_WORKSPACE_ID: process.env.SARVAM_VOICE_AGENT_WORKSPACE_ID,
  SARVAM_VOICE_AGENT_APP_ID: process.env.SARVAM_VOICE_AGENT_APP_ID,
};

const missing = Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error("voice-agent: not configured. Missing:");
  for (const k of missing) console.error(`    ${k}`);
  console.error("\n  The Speak tab will fall back to the cited cascade, which still works.");
  console.error("  See .env.example for where each value comes from.");
  process.exit(1);
}

const url = `${UPSTREAM}/orgs/${need.SARVAM_VOICE_AGENT_ORG_ID}` +
  `/workspaces/${need.SARVAM_VOICE_AGENT_WORKSPACE_ID}` +
  `/apps/${need.SARVAM_VOICE_AGENT_APP_ID}/url`;

console.log("voice-agent: performing the real handshake…");
console.log(`  org       ${need.SARVAM_VOICE_AGENT_ORG_ID}`);
console.log(`  workspace ${need.SARVAM_VOICE_AGENT_WORKSPACE_ID}`);
console.log(`  app       ${need.SARVAM_VOICE_AGENT_APP_ID}`);
console.log(`  key       ${need.SARVAM_VOICE_AGENT_KEY.slice(0, 6)}… (${need.SARVAM_VOICE_AGENT_KEY.length} chars)`);

const res = await fetch(url, {
  headers: { "X-API-Key": need.SARVAM_VOICE_AGENT_KEY, Accept: "application/json" },
  signal: AbortSignal.timeout(15_000),
}).catch((e) => { console.error(`\n✗ network: ${e.message}`); process.exit(1); });

const body = await res.text();

// Each status means a different one of the four values is wrong. Saying which
// is the entire point of this script.
if (res.status === 200) {
  let signed = null;
  try { signed = JSON.parse(body); } catch { /* fall through */ }
  console.log(`\n✓ handshake OK — Sarvam returned a signed socket URL`);
  if (signed?.url) console.log(`  url starts ${String(signed.url).slice(0, 48)}…`);
  if (signed?.reference_id) console.log(`  reference_id ${signed.reference_id}`);
  console.log("\n  Set the same four variables in Vercel (Production and Preview),");
  console.log("  redeploy, and the Speak tab will use speech-to-speech.");
  process.exit(0);
}

console.error(`\n✗ handshake failed: HTTP ${res.status}`);
console.error(`  ${body.slice(0, 300)}`);
if (res.status === 401 || res.status === 403) {
  console.error("\n  -> SARVAM_VOICE_AGENT_KEY is wrong, or is a platform key.");
  console.error("     Voice Agents keys come from indus.sarvam.ai -> Settings -> API Key.");
  console.error("     The sk_... key used for /api/chat is NOT accepted here.");
} else if (res.status === 404) {
  console.error("\n  -> One of ORG_ID / WORKSPACE_ID / APP_ID does not exist.");
  console.error("     Read them from the dashboard URL while the agent is open.");
} else if (res.status === 422) {
  console.error("\n  -> The ids are present but malformed.");
}
process.exit(1);
