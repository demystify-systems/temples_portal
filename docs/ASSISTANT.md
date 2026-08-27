# Ask the Atlas — multilingual assistant architecture

Status: **design + provider verified.** Provider is **Sarvam AI** — see "Provider: measured, not assumed".

The backlog already scopes this as Q4: *"Q&A grounded strictly in the cited database, with
citations shown and refusal when unsourced. Must never hallucinate a temple."*

That sentence is the whole design. Everything below exists to make it true.

## Why the obvious build is the wrong one

The tempting version is: system prompt + the corpus in context + a chat box. It fails here
for a specific reason. This project's entire moat is that **every fact carries a source**
(CLAUDE.md rule 2). An assistant that answers fluently from model weights destroys that in
the most damaging way possible — invisibly, in the voice of the site, to a pilgrim who may
act on it. A wrong darshan timing or a wrong phone number is not a bad answer, it is a
wasted journey.

So the assistant is built as **retrieval with refusal**, not as a chatbot with a knowledge
base bolted on.

## The contract

1. **Every claim traces to a record.** The model receives retrieved records and may only
   assert what is in them. Answers render with the same citation chips the site already uses.
2. **Refusal is a first-class success.** "I don't have a sourced answer for that" is the
   correct output for anything not in the corpus. It is not a failure to be prompted away.
3. **History and legend stay separate** (rule 3). `significance` and `story` are passed as
   distinct labelled fields and the answer must keep them distinct. The assistant may say
   "the temple tradition holds that…" — it may never present katha as documented history.
4. **Phone numbers only from `phone`**, which by the gate's own constraint only exists
   alongside a cited official `website` (rule 4 / G4). The assistant never composes,
   guesses, or "helpfully" formats a number it was not given.
5. **No tier inflation.** If a record is compact, the assistant says what is known and what
   is not. It never fills a gap conversationally.

## Shape

```
question (any language)
   │
   ├─ detect language, keep it for the reply
   ├─ translate the QUERY to English for retrieval (the corpus is English)
   │
   ▼
retrieval over the corpus                     ← src/lib/ai/retrieve.ts
   ├─ reuses src/lib/search.ts (synonyms, deity aliases, diacritics)
   ├─ + PostGIS sites_within_km / sites_in_bbox for "near me"
   └─ returns N records with their sources
   │
   ├─ nothing retrieved ──────────────► refuse, offer the gazetteer
   ▼
answer generation                             ← src/app/api/chat/route.ts
   ├─ records injected as structured, labelled fields (not prose)
   ├─ tools: findSites, siteDetail, contactInfo, nearbySites, circuitMembers
   ├─ reply in the asker's language
   └─ citations attached per claim
```

**Multilingual without a translation layer for the corpus.** The corpus stays English; only
the *question* is normalised for retrieval and the *answer* is generated in the user's
language. This is what makes "any language" affordable today — it needs no J1/J2 work
first, and it degrades honestly: proper nouns stay in their native script where the record
carries `native`.

## Contact access (the specific ask)

`contactInfo(siteId)` returns only what the record actually holds — `website`, `phone`,
`access` — each with its source, plus an explicit `missing: []` list. The tool returns the
absence as data so the model reports it rather than papering over it:

```json
{ "site": "kashi-vishwanath", "website": {...}, "phone": null,
  "missing": ["phone", "access"],
  "note": "No official phone is published for this site. We do not list unverified numbers." }
```

That note is the product working correctly, not a gap.

## Provider strategy

The router (`src/lib/ai/router.ts`) is **provider-agnostic on purpose**. Welding this to one
vendor is a mistake at this stage: the assistant is a thin layer over retrieval, the
retrieval is the hard part, and models get cheaper and better on a timescale shorter than
this roadmap. The router takes a provider config and a key, normalises streaming and tool
calls, and falls back on 401/429.

This is also why the key lives in `.env.local` and never in the repo (it is public).

## Provider: Sarvam AI — measured, not assumed

Probed live on 2026-08-27 with the key in `.env.local`. Findings that change the design:

| Question | Answer |
|---|---|
| Endpoint | `https://api.sarvam.ai/v1/chat/completions`, OpenAI-shaped |
| Auth header | `api-subscription-key` (NOT `Authorization: Bearer`) |
| Models | `sarvam-105b`, `sarvam-105b-conversations`. **`sarvam-m` is deprecated** |
| Tool calling | **Yes** — returns a standard `tool_calls` array |
| Reasoning model | **Yes** — emits `reasoning_content` before `content` |

**The gotcha that will bite anyone who skips the probe:** because it reasons first,
`max_tokens` is consumed by `reasoning_content` before a single visible character is
produced. At `max_tokens: 10` the reply came back empty. A Tamil prompt at `max_tokens: 600`
*also* came back empty — Indic reasoning traces run long. So:

- Set a **floor** of ~1500 `max_tokens` for any user-facing answer, higher for Indic scripts.
- Treat `content === null` with `finish_reason: "length"` as **retry with a larger budget**,
  never as a refusal and never as an empty answer to render.
- Bill against `usage.completion_tokens`, which includes the reasoning — it is not free.

Why Sarvam is the right pick here rather than a generic vendor: it is Indic-first, and the
adjacent APIs are the ones this product actually needs — **Saarika** (speech-to-text),
**Bulbul** (text-to-speech), **Mayura** (translation), and transliteration. A pilgrim
standing at a temple gate who cannot type Tamil should be able to ask out loud and hear the
answer back. That is a genuine accessibility win, not a demo.

### Voice: verified end-to-end, 2026-08-27

Not assumed — round-tripped. Tamil text → Bulbul → 68 KB WAV → Saarika → the **exact**
input string back, `language_probability: 0.986`.

| Capability | Endpoint | Notes |
|---|---|---|
| Text-to-speech | `POST /text-to-speech` | `{text, target_language_code}` → `{audios: [base64]}` |
| Speech-to-text | `POST /speech-to-text` | multipart `file` + `model`; returns transcript **and** detected `language_code` |
| Translation | `POST /translate` | `{input, source_language_code, target_language_code}` |

STT models: `saarika:v2.5` · `saarika:flash` · `saaras:v3` · **`saaras:v3-realtime`** ·
`saaras:v4` · `saaras:v4-multispk`. The realtime variant is what a hold-to-talk button
should use; `saarika:flash` suits short one-shot questions.

Two design consequences:

1. **STT returns the detected language**, so the reply language is a measured value, not a
   guess or a browser-locale assumption. That single field is what makes "ask in any
   language, get an answer in that language" reliable rather than aspirational.
2. **Bulbul returns base64 audio in JSON**, not a stream. For long answers, chunk the text
   at sentence boundaries and stream the clips, or the pilgrim stares at a spinner while a
   whole paragraph is synthesised.

## Voice, and why it is worth doing here

The usual argument against voice is that it multiplies failure modes. It still does. But
this audience is disproportionately older, on mobile, in bright sunlight, often in a queue,
and frequently more fluent speaking their language than typing it. Text-only quietly
excludes them.

The refusal contract makes voice safer here than in most products: the assistant only ever
speaks what it can cite, so a mis-transcription yields "I don't have a sourced answer"
rather than a confident wrong one.
