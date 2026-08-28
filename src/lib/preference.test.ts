import test from "node:test";
import assert from "node:assert/strict";
import { readPreference, writePreference, PREF_KEYS } from "./preference.ts";

/** A minimal localStorage, and a hostile one, since both are real. */
const withStorage = (impl: Partial<Storage> | null, run: () => void) => {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = impl === null ? undefined : { localStorage: impl };
  try { run(); } finally { (globalThis as { window?: unknown }).window = previous; }
};

const memoryStore = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    _map: map,
  } as unknown as Storage & { _map: Map<string, string> };
};

test("a value written is read back", () => {
  withStorage(memoryStore(), () => {
    writePreference(PREF_KEYS.uiLanguage, "ta-IN");
    assert.equal(readPreference(PREF_KEYS.uiLanguage, null), "ta-IN");
  });
});

test("an unset preference is the fallback", () => {
  withStorage(memoryStore(), () => {
    assert.equal(readPreference("never.written", "en-IN"), "en-IN");
    assert.equal(readPreference("never.written", null), null);
    assert.equal(readPreference("never.written", true), true);
  });
});

test("keys are namespaced, so the atlas cannot collide with anything else on the origin", () => {
  const store = memoryStore();
  withStorage(store, () => {
    writePreference(PREF_KEYS.legendOpen, false);
    const keys = [...store._map.keys()];
    assert.equal(keys.length, 1);
    assert.ok(keys[0].startsWith("tirtha."), `${keys[0]} is not namespaced`);
  });
});

test("blocked storage never throws — it degrades to the fallback", () => {
  // localStorage THROWS in a private window, in a webview with site data
  // blocked, and with cookies disabled. An uncaught throw here would take the
  // whole client component down to remember a checkbox.
  const hostile = {
    getItem: () => { throw new DOMException("blocked"); },
    setItem: () => { throw new DOMException("blocked"); },
  } as unknown as Storage;
  withStorage(hostile, () => {
    assert.doesNotThrow(() => writePreference(PREF_KEYS.uiLanguage, "hi-IN"));
    assert.equal(readPreference(PREF_KEYS.uiLanguage, "en-IN"), "en-IN");
  });
});

test("a corrupt stored value degrades rather than crashing", () => {
  // Written by an older version, or edited by hand in devtools.
  const store = memoryStore();
  store.setItem("tirtha.ui.lang", "{not json");
  withStorage(store, () => {
    assert.equal(readPreference(PREF_KEYS.uiLanguage, "en-IN"), "en-IN");
  });
});

test("server-side rendering has no window and must not throw", () => {
  withStorage(null, () => {
    assert.doesNotThrow(() => writePreference(PREF_KEYS.uiLanguage, "ta-IN"));
    assert.equal(readPreference(PREF_KEYS.uiLanguage, "en-IN"), "en-IN");
  });
});

test("the voice language and the interface language are separate keys", () => {
  // Someone may read the interface in English and prefer to SPEAK in Tamil.
  // Collapsing the two would silently change one when they set the other.
  assert.notEqual(PREF_KEYS.uiLanguage, PREF_KEYS.voiceLanguage);
});
