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

test("version defaults to 1, because the handshake 404s without one", () => {
  // Arrange: a deployment that never heard of SARVAM_VOICE_AGENT_VERSION.
  withEnv({ ...FULL }, () => {
    // Act
    const config = voiceAgentConfig();
    // Assert
    assert.equal(config.version, 1);
  });
});

test("an explicit version wins, so a second published version can be selected", () => {
  withEnv({ ...FULL, SARVAM_VOICE_AGENT_VERSION: "3" }, () => {
    assert.equal(voiceAgentConfig().version, 3);
  });
});

test("junk versions fall back instead of reaching the SDK", () => {
  // An unset dashboard variable often arrives as "" rather than absent, and a
  // NaN would be dropped by the SDK as falsy — reproducing the original 404
  // with no clue as to why.
  for (const junk of ["", "   ", "latest", "0", "-1", "1.5"]) {
    withEnv({ ...FULL, SARVAM_VOICE_AGENT_VERSION: junk }, () => {
      assert.equal(voiceAgentConfig().version, 1, `"${junk}" should fall back`);
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
