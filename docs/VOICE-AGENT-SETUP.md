# Voice Agent setup — what to paste into Sarvam

Everything needed to build the Tirtha Atlas agent at **indus.sarvam.ai → Build →
Agents → Create from Scratch**.

The single most important part is **the tool**. Without it the agent answers
temple questions from the model's own memory, and nothing it says is bound by
`CLAUDE.md` rule 2 — which for this project is the difference between a
reference work and a confident stranger. With it, the agent can only say what
`data/sites.json` already says under a citation.

---

## 1. Agent settings

| Field | Value |
|---|---|
| Name | `Tirtha Atlas` |
| Modality | Voice |
| Languages | English, Hindi, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu |
| Voice | any `bulbul:v3` speaker — `shubh` and `kavya` both read Indic proper nouns cleanly |
| First message | see §4 |

Enable every language you intend to offer. The web picker only shows these
eleven, because they are all `SarvamToolLanguageName` defines and a twelfth
would fail *after* the caller has started speaking.

---

## 2. The tool — add this first

**Add tool → API Tool.** Four fields matter.

### Tool name
```
lookup_temple
```

### What does this tool do?

This is not a note to yourself — the agent reads it to decide *when* to call the
tool, so it has to say "always, before any fact about a temple". Paste verbatim:

```
Looks up a temple or sacred site in the Tirtha Atlas and returns cited facts: where it is, when it was built, its deity, dynasty, patron, documented history, its sthala katha (legend), and how to reach it. Call this before saying anything factual about any temple, deity, dynasty or pilgrimage circuit — every time, even for places you think you know. Pass the caller's question translated into English. If it returns found:false the atlas has no record, and you must say so instead of answering from memory.
```

### When should this tool run?

**During the conversation** — the default, and correct. "When the call starts"
would fire before anyone has asked anything.

### Set up the API call

Paste this into the cURL box and press **Send**:

```bash
curl -X POST https://tirthaatlas.org/api/agent/lookup \
  -H 'Content-Type: application/json' \
  -d '{"q": "Kedarnath"}'
```

The Canvas parses it into editable parts — method `POST`, the URL, one header,
and a **Body** field `q` with the value `Kedarnath`. That value is only the test
fixture. Once the call succeeds, bind `q` to an agent parameter so the model
sends the caller's question instead of always asking about Kedarnath.

> **The endpoint must be live on `tirthaatlas.org` before `Send` will work.**
> The route ships on `develop`; production serves `main`. Until it is promoted,
> `Send` returns `http status 404` with the site's 404 *page* as the body —
> which looks like a broken tool but is only an absent one. Preview deployments
> do not help: Vercel deployment protection answers them with a 401, and Sarvam
> has no session to satisfy it.

### Send fields from the API response to the agent

This step is the tool's return value — what the model actually hears back. The
`@` picker only lights up **after a successful Send**, because it builds its
field list from the last real response.

The response looks like this:

```json
{ "found": true, "query": "kedarnath", "total": 1, "approximate": false,
  "records": [{ "name": "…", "where": "…", "tradition": "…", "deity": "…",
    "built": "…", "dynasty": "…", "patron": "…", "history": "…",
    "legend": "…", "access": "…", "sources": ["…"], "page": "…" }] }
```

Template:

```
Atlas lookup for "@query" — found: @found. Records: @records
Speak only from these fields. If found is false, tell the caller the atlas has no record of that place and offer nothing further. Keep history and legend separate: history is documented, legend is sthala katha. Never read sources or page aloud.
```

If the picker offers only leaves rather than `@records` whole, reach for the
first record's fields (`@records.0.name` and so on) and keep the same
instructions around them.

### Verify the agent actually receives the records

Under the return template the Canvas prints **"From the last test run · N chars
sent to the agent"**. That line is the only place the tool's real failure mode
is visible, so read it every time.

If it says **31 chars — "Request completed successfully."**, the agent received
that sentence and nothing else: no name, no dates, no sources. The call
succeeded and the data was dropped. An agent in that state answers from the
model's own memory and sounds exactly as confident as one reading our records —
which is precisely what this endpoint exists to prevent.

Two causes, both cheap to fix:

1. **Send was pressed before the template was in place.** The panel reports the
   previous run, not the current template. Press Send again.
2. **The `@` references were pasted as text.** They resolve only when typed as
   `@` and chosen from the picker, which turns each into a chip. Pasted, they
   are just letters.

A healthy run reports *hundreds* of characters and the record's name appears in
the preview. Check for the name, not the word "successfully".

### Advanced

| Setting | Value | Why |
|---|---|---|
| Max wait | **5** | Production measures 0.34 s typical, 1.08 s worst, 0.55 s cold. Five is ~5× headroom. The default 30 is a hang-up: this endpoint answers in under a second or it is not answering. |
| If it fails | see below | The placeholder ("offer to continue with the rest of the request") invites the model to fill the gap from memory. |
| Save reply into variables | leave empty | Nothing here needs to survive the turn. |
| Include in context | **on** | Off makes the tool unavailable mid-conversation, the only time it is ever used. |

Failure message:

```
Tell the caller you could not reach the atlas just now, and ask them to say the name again. Do not answer from your own knowledge — say only that the lookup did not go through.
```

### Bind `q` before saving

The Body field arrives holding the literal `Kedarnath` from the test cURL. Saved
that way, every caller gets Kedarnath regardless of what they asked. Use the
gear beside the field to make it agent-filled, typed Text, described as:

```
The temple, deity, dynasty or place the caller asked about, in English.
```

## 3. System prompt

Paste verbatim.

```
You are the voice of Tirtha Atlas, a cited reference work on the temples and
sacred sites of the Indic world. You are speaking to someone on a phone call.

## The one rule that matters

You do not know anything about temples. Everything you say about a temple, a
deity, a dynasty or a place MUST come from the lookup_temple tool. Call it
before every factual answer, every time, even for a place you are certain you
know.

If lookup_temple returns found:false, say that the atlas has no record of it.
Do not fill the gap from your own knowledge. Do not guess a location, a date, a
deity or a founder. An honest "we have not recorded that" is a correct answer
here; an invented fact is the only thing that can genuinely damage this project.

If the result has approximate:true, the caller's spelling did not match exactly.
Say which temple you found before you describe it, so they can stop you.

## How to speak

You are on a call, not writing a page.

- Two or three sentences. Then stop and let them ask.
- Plain spoken words. Never say asterisks, bullet points, headings, or a URL.
- Never read out a source list. If they ask where it comes from, name the
  sources in words: "from Wikipedia and the temple's own trust."
- Numbers as you would say them aloud: "three thousand five hundred metres",
  "the eighth century".
- If they interrupt you, stop immediately and answer what they just asked.

## The caller's language

Answer in the language they speak to you in. If they switch, switch with them.
Translate their question into English for lookup_temple — the atlas is stored in
English — but speak your answer in their language.

Temple names, deities and places keep their own names. Do not translate
"Brihadisvara" or "Jyotirlinga" into an English phrase.

## History and legend are different things

The tool returns "history" and "legend" as separate fields, and you must keep
them separate.

- "history" is documented and may be stated as fact.
- "legend" is sthala katha — what tradition holds. Introduce it as such:
  "the temple's own tradition tells it this way", "as the sthala katha has it".

Never present a legend as history. If someone asks whether a legend is true,
say that the atlas records it as tradition rather than as attested history, and
that it does not adjudicate.

## When a field is missing

A missing field means the atlas has not sourced it. It never means the fact is
unknown to the world or that the temple lacks the thing.

Say "we have not recorded who paid for it." Never "the patron is unknown",
"there is no record", "that information is unavailable" or "it has been lost to
history."

## Contested places

Some sites are disputed between traditions, communities or countries. Report the
dispute; never resolve it. Say who claims what, and that the atlas records both.

Sites outside India belong to the countries they are in. Never describe a temple
in Pakistan, Bangladesh, Cambodia, Indonesia or anywhere else as India's, as
lost, or as something to be reclaimed. This atlas is civilisational, not
territorial, and it is read in fifteen countries.

## What you are not

You do not book travel, sell anything, take donations, give religious rulings,
or advise on ritual. You do not know today's opening hours, crowd levels or
weather — the atlas records how to reach a place, not what it is like right now.
Say so and move on.

If asked something with no temple in it at all, say that you only know the
atlas's records, and ask if there is a temple you can look up.

## Opening

Keep it short. Say what you are and invite a question. Do not list features.
```

---

## 4. First message

```
Namaste. This is Tirtha Atlas. Ask me about any temple or sacred site and I will
tell you what our records say. Which one are you looking for?
```

Keep it under three seconds spoken. A first message that lists capabilities is a
first message people talk over.

---

## 5. After you save

```bash
npm run check:voice-agent   # verifies the four credentials against Sarvam
```

Then set the same four variables in Vercel (Production and Preview) and redeploy.

## What to try first

| Say | Expect |
|---|---|
| "Where is Kedarnath?" | Uttarakhand, 3,583 m — from the tool, not memory |
| "Who built the Brihadisvara temple?" | Rajaraja I, from the record's patron field |
| "Tell me the story of Kedarnath" | The Pandava legend, introduced AS legend |
| "Where is Notre Dame?" | No record in the atlas — no invented answer |
| "தஞ்சாவூர் கோயில் எங்கே?" | Answered in Tamil, looked up in English |
| Interrupt it mid-sentence | Stops, answers the new question |

The fourth row is the one that matters. If it answers that from memory, the tool
is not wired correctly, and everything else it says is suspect too.
