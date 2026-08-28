import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPOKEN_LANGUAGES } from "./languages.ts";

/**
 * Pins the Voice Agents language list.
 *
 * `SarvamToolLanguageName` cannot be imported: dist/types/language.d.ts defines
 * it, dist/types/index.d.ts does not re-export it, and the package's `exports`
 * map blocks a deep import. So VoiceAgentPanel writes the eleven strings out,
 * and this test is the only thing standing between an upstream rename and a
 * call that drops after someone has started speaking.
 *
 * Read out of the SDK's own shipped .d.ts rather than restated here, so the
 * assertion is against what is installed, not against a second copy of the list.
 */
const SDK_ENUM = "node_modules/sarvam-conv-ai-sdk/dist/types/language.d.ts";
const PANEL = "src/app/VoiceAgentPanel.tsx";

const sdkLanguages = (): string[] => {
  const src = readFileSync(SDK_ENUM, "utf8");
  return [...src.matchAll(/^\s+[A-Z_]+ = "([^"]+)",?$/gm)].map((m) => m[1]!).sort();
};

const panelLanguages = (): string[] => {
  const src = readFileSync(PANEL, "utf8");
  const block = src.slice(src.indexOf("const AGENT_LANGUAGES"), src.indexOf("} as const;"));
  return [...block.matchAll(/"[a-z]{2,3}-IN":\s*"([^"]+)"/g)].map((m) => m[1]!).sort();
};

test("every language the panel offers is one the SDK's enum defines", () => {
  const sdk = sdkLanguages();
  assert.ok(sdk.length > 0, `no enum members parsed from ${SDK_ENUM}`);
  for (const name of panelLanguages()) {
    assert.ok(sdk.includes(name), `"${name}" is not a SarvamToolLanguageName — the socket will refuse it`);
  }
});

test("the panel offers every language the SDK supports", () => {
  // The other direction. A language Sarvam adds and we never offer is a
  // capability quietly left on the floor.
  const panel = panelLanguages();
  for (const name of sdkLanguages()) {
    assert.ok(panel.includes(name), `the SDK supports "${name}" and the panel does not offer it`);
  }
});

test("each Voice Agents language maps from a tag the atlas already knows", () => {
  // The picker filters SPOKEN_LANGUAGES by this map, so a tag with no entry in
  // languages.ts would silently vanish from the dropdown.
  const src = readFileSync(PANEL, "utf8");
  const block = src.slice(src.indexOf("const AGENT_LANGUAGES"), src.indexOf("} as const;"));
  const codes = [...block.matchAll(/"([a-z]{2,3}-IN)":/g)].map((m) => m[1]!);
  assert.equal(codes.length, 11, "Voice Agents supports eleven languages");
  for (const code of codes) {
    assert.ok(
      SPOKEN_LANGUAGES.some((l) => l.code === code),
      `${code} has no endonym in languages.ts, so the picker cannot label it`,
    );
  }
});

test("the spoken panel is fewer languages than the typed assistant, and that is stated", () => {
  // 22 understood by the typed assistant, 11 by this socket. If they ever match,
  // the copy explaining the difference should go too.
  const src = readFileSync(PANEL, "utf8");
  const block = src.slice(src.indexOf("const AGENT_LANGUAGES"), src.indexOf("} as const;"));
  const codes = [...block.matchAll(/"([a-z]{2,3}-IN)":/g)].length;
  assert.ok(codes < SPOKEN_LANGUAGES.length, "the panel should offer a subset");
});
