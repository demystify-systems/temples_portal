import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  MIN_AUDIO_BYTES,
  MIN_RECORDING_MS,
  RECORDING_MIME_PREFERENCE,
  SPEAKABLE_LANGUAGES,
  TTS_MAX_CHARS,
  base64ToBlob,
  baseMimeType,
  chunkForSpeech,
  elapsedLabel,
  fileNameFor,
  guardAudio,
  isSpeakable,
  languageLabel,
  normaliseLanguageCode,
  pickRecordingMime,
  speechLanguage,
  sttModelFor,
  withinLimit,
} from "./voice.ts";

// ---------------------------------------------------------------------------
// model choice
// ---------------------------------------------------------------------------

test("short clips go to the flash model, long ones to the accurate one", () => {
  assert.equal(sttModelFor(2_000), "saarika:flash");
  assert.equal(sttModelFor(15_000), "saarika:flash", "the boundary stays on flash");
  assert.equal(sttModelFor(15_001), "saarika:v2.5");
  assert.equal(sttModelFor(29_000), "saarika:v2.5");
});

test("an unknown duration is treated as short, never as a reason to fail", () => {
  assert.equal(sttModelFor(null), "saarika:flash");
  assert.equal(sttModelFor(undefined), "saarika:flash");
  assert.equal(sttModelFor(Number.NaN), "saarika:flash");
});

// ---------------------------------------------------------------------------
// audio guards
// ---------------------------------------------------------------------------

test("a normal recording passes", () => {
  const guard = guardAudio({ size: 40_000, durationMs: 4_000, type: "audio/webm;codecs=opus" });
  assert.equal(guard.ok, true);
});

test("an oversized upload is rejected before it can cost an API call", () => {
  const guard = guardAudio({ size: MAX_AUDIO_BYTES + 1, durationMs: 4_000, type: "audio/webm" });
  assert.equal(guard.ok, false);
  assert.equal(guard.ok === false && guard.code, "too-large");
});

test("an empty body and a header-only body are told apart", () => {
  const empty = guardAudio({ size: 0 });
  const tiny = guardAudio({ size: MIN_AUDIO_BYTES - 1 });
  assert.equal(empty.ok === false && empty.code, "empty");
  assert.equal(tiny.ok === false && tiny.code, "too-short");
});

test("duration past the cap is rejected, with slack for the trailing chunk", () => {
  const justOver = guardAudio({ size: 50_000, durationMs: MAX_RECORDING_MS + 500 });
  assert.equal(justOver.ok, true, "the last dataavailable lands after the stop");

  const wayOver = guardAudio({ size: 50_000, durationMs: MAX_RECORDING_MS + 10_000 });
  assert.equal(wayOver.ok === false && wayOver.code, "too-long");
});

test("a mis-tap is rejected as too short even when the bytes look plausible", () => {
  const guard = guardAudio({ size: 50_000, durationMs: MIN_RECORDING_MS - 1 });
  assert.equal(guard.ok === false && guard.code, "too-short");
});

test("only real audio containers are accepted", () => {
  for (const type of ACCEPTED_AUDIO_TYPES) {
    assert.equal(guardAudio({ size: 50_000, type }).ok, true, type);
  }
  const bad = guardAudio({ size: 50_000, type: "application/zip" });
  assert.equal(bad.ok === false && bad.code, "unsupported-type");
});

test("a codec parameter does not make a supported container unsupported", () => {
  assert.equal(baseMimeType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(baseMimeType("AUDIO/WEBM; codecs=opus"), "audio/webm");
  assert.equal(baseMimeType(null), "");
  assert.equal(guardAudio({ size: 50_000, type: "audio/ogg; codecs=opus" }).ok, true);
});

test("a missing content type is not held against the upload", () => {
  // Some browsers hand back a Blob with an empty type. That is not a reason to
  // refuse a recording the user just made.
  assert.equal(guardAudio({ size: 50_000, type: "" }).ok, true);
  assert.equal(guardAudio({ size: 50_000, type: null }).ok, true);
});

test("every rejection carries plain wording, not a code, and never the word error", () => {
  const cases = [
    guardAudio({ size: 0 }),
    guardAudio({ size: 10 }),
    guardAudio({ size: MAX_AUDIO_BYTES + 1 }),
    guardAudio({ size: 50_000, durationMs: 999_999 }),
    guardAudio({ size: 50_000, type: "text/plain" }),
  ];
  for (const guard of cases) {
    assert.equal(guard.ok, false);
    if (guard.ok) continue;
    assert.ok(guard.message.length > 20, `too terse: ${guard.message}`);
    assert.ok(!/error|invalid|failed/i.test(guard.message), `not plain wording: ${guard.message}`);
    assert.ok(/[.!]$/.test(guard.message), `not a sentence: ${guard.message}`);
  }
});

// ---------------------------------------------------------------------------
// recording container
// ---------------------------------------------------------------------------

test("Safari's only option is chosen when it is the only one supported", () => {
  const safari = (type: string) => type.startsWith("audio/mp4");
  assert.equal(pickRecordingMime(safari), "audio/mp4");
});

test("Chrome and Firefox get an Opus container", () => {
  const chrome = (type: string) => type.startsWith("audio/webm");
  const firefox = (type: string) => type.startsWith("audio/ogg");
  assert.equal(pickRecordingMime(chrome), "audio/webm;codecs=opus");
  assert.equal(pickRecordingMime(firefox), "audio/ogg;codecs=opus");
});

test("a browser that admits to nothing gets the default, not a thrown error", () => {
  assert.equal(pickRecordingMime(() => false), undefined);
});

test("the preference order puts mp4 first, because Safari records nothing else", () => {
  assert.equal(RECORDING_MIME_PREFERENCE[0], "audio/mp4");
});

test("the filename extension matches the container Sarvam is handed", () => {
  assert.equal(fileNameFor("audio/mp4"), "question.m4a");
  assert.equal(fileNameFor("audio/webm;codecs=opus"), "question.webm");
  assert.equal(fileNameFor("audio/ogg;codecs=opus"), "question.ogg");
  assert.equal(fileNameFor("audio/wav"), "question.wav");
  assert.equal(fileNameFor("audio/mpeg"), "question.mp3");
  assert.equal(fileNameFor(undefined), "question.webm");
});

// ---------------------------------------------------------------------------
// languages
// ---------------------------------------------------------------------------

test("detected codes normalise to the xx-IN form Sarvam accepts", () => {
  assert.equal(normaliseLanguageCode("ta-IN"), "ta-IN");
  assert.equal(normaliseLanguageCode("ta"), "ta-IN");
  assert.equal(normaliseLanguageCode(" hi_in "), "hi-IN");
  assert.equal(normaliseLanguageCode("BN-in"), "bn-IN");
});

test("Odia's ISO spelling becomes the spelling the API uses", () => {
  // Sarvam says od-IN; ISO 639-1 and every browser locale say or.
  assert.equal(normaliseLanguageCode("or-IN"), "od-IN");
  assert.equal(normaliseLanguageCode("or"), "od-IN");
  assert.ok(SPEAKABLE_LANGUAGES.includes("od-IN"));
});

test("a foreign region is pulled to IN rather than sent as a code the API would reject", () => {
  assert.equal(normaliseLanguageCode("en-GB"), "en-IN", "a browser locale still has to be speakable");
  assert.equal(speechLanguage("en-GB"), "en-IN");
  assert.equal(normaliseLanguageCode("en-us-posix"), null, "a tag that is not a language tag is refused");
});

test("an undetected language is null, not a guess", () => {
  assert.equal(normaliseLanguageCode("unknown"), null, "Saarika's own non-commitment");
  assert.equal(normaliseLanguageCode(null), null);
  assert.equal(normaliseLanguageCode(""), null);
  assert.equal(normaliseLanguageCode("   "), null);
  assert.equal(normaliseLanguageCode("नमस्ते"), null, "text is not a language tag");
});

test("labels are human, and an unknown code shows itself rather than being invented", () => {
  assert.equal(languageLabel("ta-IN"), "Tamil");
  assert.equal(languageLabel("ta"), "Tamil");
  assert.equal(languageLabel("or"), "Odia");
  assert.equal(languageLabel("zz-IN"), "zz-IN", "no label is better than a wrong one");
  assert.equal(languageLabel(null), "an unrecognised language");
});

test("a language Saarika hears but Bulbul cannot speak is reported, never swapped for English", () => {
  assert.equal(isSpeakable("ta-IN"), true);
  assert.equal(isSpeakable("ur-IN"), false, "Urdu is heard but not spoken back");
  assert.equal(speechLanguage("ur-IN"), null, "the caller must be told, not handed en-IN");
  assert.equal(speechLanguage("ta"), "ta-IN");
  assert.equal(speechLanguage(null), null);
});

test("every speakable language has a label", () => {
  for (const code of SPEAKABLE_LANGUAGES) {
    assert.notEqual(languageLabel(code), code, `${code} has no human label`);
  }
});

// ---------------------------------------------------------------------------
// speech chunking — the base64-is-not-a-stream workaround
// ---------------------------------------------------------------------------

test("a short answer is one clip, so a one-liner is not chopped up", () => {
  assert.deepEqual(chunkForSpeech("Kedarnath is open from May."), ["Kedarnath is open from May."]);
});

test("chunks break at sentence ends, not mid-word", () => {
  const text = `${"a".repeat(200)}. ${"b".repeat(200)}. ${"c".repeat(200)}.`;
  const chunks = chunkForSpeech(text, 300);
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) assert.ok(chunk.endsWith("."), `sentence cut short: ${chunk.slice(-20)}`);
});

test("the Devanagari danda is a sentence end", () => {
  const chunks = chunkForSpeech("काशी विश्वनाथ वाराणसी में है। यह एक ज्योतिर्लिंग है॥", 40);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0]!.endsWith("।"));
  assert.ok(chunks[1]!.endsWith("॥"));
});

test("a decimal point and an abbreviation do not split a sentence", () => {
  // Splitting here would make the clock read as two clips: "at 3." then "30 p."
  const chunks = chunkForSpeech("Darshan begins at 3.30 p.m. sharp.", 400);
  assert.deepEqual(chunks, ["Darshan begins at 3.30 p.m. sharp."]);
});

test("a sentence longer than the limit is split at a word boundary", () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const chunks = chunkForSpeech(words, 100);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 100, `chunk of ${chunk.length} exceeds the limit`);
    assert.ok(/^word\d+/.test(chunk), `split mid-word: ${chunk.slice(0, 12)}`);
    assert.ok(/word\d+$/.test(chunk), `split mid-word: ${chunk.slice(-12)}`);
  }
});

test("an unbroken run with no whitespace is still cut rather than sent whole", () => {
  const chunks = chunkForSpeech("x".repeat(1000), 200);
  assert.equal(chunks.length, 5);
  for (const chunk of chunks) assert.equal(chunk.length, 200);
});

test("chunking loses nothing — the clips read back as the answer", () => {
  const answer =
    "Brihadisvara Temple stands at Thanjavur. It was built under Rajaraja I and completed around 1010 CE. " +
    "The temple tradition holds that the shadow of the vimana never falls on the ground; that is legend, not record. " +
    "No official phone is published for this site.";
  const chunks = chunkForSpeech(answer, 80);
  assert.ok(chunks.length >= 3, "a paragraph must become several clips");
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), answer.replace(/\s+/g, " "));
});

test("no chunk is ever empty or whitespace, whatever the spacing", () => {
  const chunks = chunkForSpeech("One.\n\n\nTwo.   Three.\t\tFour.", 12);
  assert.ok(chunks.length > 0);
  for (const chunk of chunks) assert.equal(chunk, chunk.trim());
  for (const chunk of chunks) assert.ok(chunk.length > 0);
});

test("nothing to say produces no calls at all", () => {
  assert.deepEqual(chunkForSpeech(""), []);
  assert.deepEqual(chunkForSpeech("   \n  "), []);
});

test("the default chunk size stays under the per-call text limit", () => {
  const chunks = chunkForSpeech("Sentence. ".repeat(400));
  for (const chunk of chunks) assert.ok(chunk.length <= TTS_MAX_CHARS, `chunk of ${chunk.length}`);
});

// ---------------------------------------------------------------------------
// base64 -> Blob
// ---------------------------------------------------------------------------

test("base64 audio becomes a playable blob of the right length and type", async () => {
  const bytes = new Uint8Array([82, 73, 70, 70, 0, 1, 2, 3]); // "RIFF" + payload
  const base64 = Buffer.from(bytes).toString("base64");
  const blob = base64ToBlob(base64);
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, bytes.length);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test("a data: prefix and stray whitespace are tolerated", async () => {
  const base64 = Buffer.from("hello").toString("base64");
  const blob = base64ToBlob(`data:audio/wav;base64,${base64}\n `);
  assert.equal(blob.size, 5);
});

test("a corrupt payload throws a plain message, not the browser's atob error", () => {
  assert.throws(() => base64ToBlob("!!!not base64!!!"), /not base64/);
  assert.throws(() => base64ToBlob(""), /empty audio payload/);
});

// ---------------------------------------------------------------------------
// rate limiting
// ---------------------------------------------------------------------------

test("requests inside the window are allowed until the ceiling", () => {
  let hits: readonly number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const outcome = withinLimit(hits, 1_000 + i, 60_000, 3);
    assert.equal(outcome.allowed, true, `call ${i + 1} should pass`);
    hits = outcome.hits;
  }
  assert.equal(withinLimit(hits, 1_004, 60_000, 3).allowed, false, "the fourth is refused");
});

test("the window slides — old hits stop counting", () => {
  const old = [1_000, 2_000, 3_000];
  const outcome = withinLimit(old, 70_000, 60_000, 3);
  assert.equal(outcome.allowed, true);
  assert.deepEqual(outcome.hits, [70_000], "expired hits are dropped, not kept");
});

test("the limiter never mutates the array it was given", () => {
  const original = [1_000, 2_000];
  const frozen = Object.freeze([...original]);
  const outcome = withinLimit(frozen, 3_000, 60_000, 5);
  assert.deepEqual(frozen, original, "input must be untouched");
  assert.equal(outcome.hits.length, 3);
});

test("a key with no history is allowed", () => {
  assert.equal(withinLimit(undefined, Date.now(), 60_000, 1).allowed, true);
});

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------

test("the recording clock reads as a clock, so the state is not colour alone", () => {
  assert.equal(elapsedLabel(0), "0:00");
  assert.equal(elapsedLabel(7_250), "0:07");
  assert.equal(elapsedLabel(59_999), "0:59");
  assert.equal(elapsedLabel(60_000), "1:00");
  assert.equal(elapsedLabel(-5), "0:00", "a clock skew must not print a negative time");
  assert.equal(elapsedLabel(Number.NaN), "0:00");
});
