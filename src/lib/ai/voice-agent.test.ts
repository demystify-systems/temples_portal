import test from "node:test";
import assert from "node:assert/strict";

import { voiceAgentConfig, voiceAgentConfigured } from "./voice-agent.ts";

const KEYS = [
  "SARVAM_VOICE_AGENT_KEY",
  "SARVAM_VOICE_AGENT_ORG_ID",
  "SARVAM_VOICE_AGENT_WORKSPACE_ID",
  "SARVAM_VOICE_AGENT_APP_ID",
  "SARVAM_VOICE_AGENT_VERSION",
] as const;

/** Set exactly this environment, restoring whatever was there afterwards. */
const withEnv = (env: Partial<Record<(typeof KEYS)[number], string>>, run: () => void) => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    run();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

const FULL = {
  SARVAM_VOICE_AGENT_KEY: "k",
  SARVAM_VOICE_AGENT_ORG_ID: "o",
  SARVAM_VOICE_AGENT_WORKSPACE_ID: "w",
  SARVAM_VOICE_AGENT_APP_ID: "a",
} as const;

test("version is unset by default, so a publish needs no redeploy", () => {
  // The handshake resolves the live published version on its own. Pinning 1
  // here would hold the agent on version 1 forever, silently, after a publish.
  withEnv({ ...FULL }, () => {
    assert.equal(voiceAgentConfig().version, null);
  });
});

test("an explicit version wins, so a second published version can be selected", () => {
  withEnv({ ...FULL, SARVAM_VOICE_AGENT_VERSION: "3" }, () => {
    assert.equal(voiceAgentConfig().version, 3);
  });
});

test("junk versions are dropped rather than sent", () => {
  // An unset dashboard variable often arrives as "" rather than absent. A NaN
  // reaching the SDK would be dropped as falsy anyway; making that explicit
  // means the pinned-version path is either a real integer or nothing.
  for (const junk of ["", "   ", "latest", "0", "-1", "1.5"]) {
    withEnv({ ...FULL, SARVAM_VOICE_AGENT_VERSION: junk }, () => {
      assert.equal(voiceAgentConfig().version, null, `"${junk}" should be dropped`);
    });
  }
});

test("a deployment is configured on the four real values, not on version", () => {
  withEnv({ ...FULL }, () => assert.equal(voiceAgentConfigured(), true));
});

test("any missing identifier leaves the deployment unconfigured", () => {
  for (const missing of Object.keys(FULL) as (keyof typeof FULL)[]) {
    const partial = { ...FULL };
    delete (partial as Record<string, string>)[missing];
    withEnv(partial, () => {
      assert.equal(voiceAgentConfigured(), false, `${missing} missing should not be configured`);
    });
  }
});
