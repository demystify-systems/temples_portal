# UX-SPEC.md — Tirtha Atlas

**Status:** specification for adoption. **Written against commit `417ffd6`, corpus 2,271 sites.**
**Audience:** Claude Code / VS Code session.

> **Read this first.** Much of what a generic UX review would recommend is **already built**:
> marker clustering (`src/lib/cluster.ts`), full keyboard traversal (`src/lib/map-keyboard.ts`),
> a three-snap-point mobile bottom sheet, skeleton loaders, an empty state, a timeline coach mark,
> a completeness badge, contested-circuit handling, dark mode, reduced-motion handling, and 44px tap
> targets. **Do not rebuild any of it.** Each screen below states what exists, then what changes.

---

## 0. Route inventory (evidence — from `src/app/`)

| Route | File | Rendering |
|---|---|---|
| `/` | `page.tsx` → `AtlasClient.tsx` | client component, whole-corpus |
| `/site/[slug]` | `site/[slug]/page.tsx` | static, + `opengraph-image.tsx` |
| `/sites` | `sites/page.tsx` | static + `SiteFilters` client |
| `/circuits`, `/circuit/[slug]` | static |
| `/dynasties`, `/dynasty/[slug]` | static |
| `/patrons`, `/patron/[slug]` | static |
| `/about`, `/support` | static |
| `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt` | route handlers |
| `/api/chat` | Assistant, gated on `SARVAM_API_KEY` |

**Missing:** there is no `not-found.tsx` and no `error.tsx`. See §9.

---

## 1. `/` — the atlas

### Exists
Shared `SiteHeader` (brand, coverage stats, hamburger drawer); filter bar (search + country,
tradition, dynasty, circuit selects, reset, live count); SVG map with pan/zoom/pinch
(`map-gestures.ts`), era-coloured marks, tradition shapes, cluster donuts with tradition pips and
exact counts; zoom tools; legend; hover tooltip; right-hand detail rail that becomes a bottom sheet
below 720px with `snap-peek` / `snap-half` / `snap-full`; timeline with play, year readout, range
scrubber, "show all"; circuit trace mode with dimming and contested daggers; coach mark; floating
"Ask the Atlas" launcher.

### Changes

**1.1 — Stop shipping the corpus to the browser. (P0, blocking everything)**
`AtlasClient.tsx` is `"use client"` and imports `SITES` from `@/lib/sites`, which imports
`data/sites.json` (2.67 MB raw). Webpack therefore inlines **the entire corpus** into the page
chunk. Measured on production: `app/page-*.js` is **737 KB compressed**; total homepage JS is
**885 KB compressed**. Every visitor downloads all 2,271 records — including every `significance`
paragraph and source array — to render dots on a map.

Split the data into two artefacts:
- **Map index** (client): `id`, `name`, `lat`, `lng`, `tradition`, `built[0]`, `origin`, `country`,
  plus whatever the facet selects need. Measured: **65 KB gzip — an 89.1% reduction.**
- **Record detail** (server): fetched or statically linked on selection. The detail rail already has
  a full page at `/site/[slug]`; the rail can render from the index plus a small per-site fetch.

Projection at the roadmap's 20,000 sites: slim index ≈ **568 KB**, full-corpus bundling ≈ **5.1 MB**.
The current architecture does not reach v0.6.

*Acceptance:* homepage JS ≤ 200 KB compressed; no `significance`, `story`, `access` or `sources`
string appears in any client chunk; map interaction unchanged.

**1.2 — First-run legibility.** The coach mark explains the timeline, but nothing states what the
product *is* before a visitor parses the map. Add one line of static, server-rendered copy in the
header region — not a modal, not an animation — naming the three claims: *cited*, *dated*,
*cross-tradition*. It must be in the initial HTML so it is readable before hydration.

*Acceptance:* with JS disabled, the page states what the atlas is and shows the coverage stats.

**1.3 — Filters do not survive a reload or a share.** Filter state lives in React state only. Encode
country/tradition/dynasty/circuit/year in the query string, restore on mount.

*Acceptance:* a filtered view is shareable by URL and survives refresh and back/forward.

**1.4 — Search is a substring match over a bundled index.** Once the corpus leaves the client
(1.1), promote the existing `scripts/build-search-index.mjs` output to the search path and add
transliteration-tolerant matching (a query in Latin should find a `native`-script record, and
"Brihadeeswarar"/"Brihadisvara" should collide).

*Acceptance:* the five most common spelling variants of ten well-known sites all resolve.

**1.5 — "Ask the Atlas" is unlabelled on first contact** and is mounted only when `SARVAM_API_KEY`
is set. Keep the gating. Give the launcher a one-line subtitle stating it answers **only** from cited
records, so it is not mistaken for a general chatbot.

---

## 2. `/site/[slug]` — the record

### Exists
Header, chips, dates block, `significance` under its own heading, `story` in `.sect.katha`
(italic, `--ink2`), practical/access, actions, sources list, `.vnote` verification note, completeness
badge, disputed-circuit notes, per-site OG image, JSON-LD.

### Changes

**2.1 — The history/legend distinction is carried by italics alone.** `CLAUDE.md` rule 3 is the
project's second-most-important guarantee, and its entire visual expression is
`.sect.katha p{color:var(--ink2);font-style:italic}`. Italic is not a semantic signal; it is invisible
to a screen-reader user and ambiguous to everyone else.

Strengthen to a **labelled panel**: a tinted `--panel2` ground, a `--line2` left rule, a mono eyebrow
reading `STHALA KATHA — TRADITIONAL ACCOUNT`, and one line of static framing copy stating that what
follows is transmitted tradition, not attested history. Mirror it in the DOM with a `<section>` and
an `aria-label`.

*Acceptance:* a screen-reader user reaches the katha and hears it identified as legend before the
prose begins. Removing CSS still leaves the distinction legible.

**2.2 — `verified` is presented as a date but is a method tag.** Values are
`wikipedia-2026-08-27` (2,102 records), `wikidata-2026-08-27` (24), `wikipedia-2026-08-26` (141),
`wikipedia-corrected-2026-08-26` (2), `curated-unverified` (2). **2,102 of 2,271 carry the same
date** — this was one automated pass, not per-record verification. Displaying it as "verified" over-
claims.

Render it honestly: state the *method* and the *date* separately — "source checked automatically
against Wikipedia, 27 Aug 2026" — and give `curated-unverified` its own explicit treatment rather
than letting it render as a verification.

*Acceptance:* no record displays the word "verified" for a `curated-unverified` value; the copy
distinguishes automated source-checking from human verification.

**2.3 — Sources are a footer list.** Citations are the moat and they sit last, at 11.5px, in
`--ink2`. Add a compact source count near the title (`2 sources` / `1 source`) that anchors to the
list, and mark Wikipedia/Wikidata versus independent sources distinctly — **corpus-wide only 260 of
2,271 records (11.4%) carry a non-Wikimedia source**, and a reader deserves to see which they are
looking at.

*Acceptance:* source count visible above the fold; independent sources visually distinguishable from
Wikimedia ones.

**2.4 — `native` renders in an unsupported script.** See `DESIGN-TOKENS.md` §4. Apply `--font-indic`
and `lang` attributes so the 747 affected records render correctly and are announced correctly.

---

## 3. Tier presentation — `Completeness.tsx`

### Exists
`src/lib/completeness.ts` is the strongest piece of design thinking in the repo: a nine-field scale,
per-tier promises, a `next` most-valuable-missing-field prompt, and `ABSENCE_CLAIM_WORDS` — a
test-enforced ban on words that would state absence as a fact about the world rather than about the
project's sourcing.

### Changes

**3.1 — The tier distribution has collapsed and the UI does not say so.**
Measured: **68 flagship, 2,203 compact, 0 stub.** Against the last tracker snapshot (1,122 sites:
150 flagship / 972 compact), flagship density has fallen from **13.4% to 3.0%** while the corpus
doubled. All 68 flagship records currently *pass* their promise (66 of them with an independent
source), so this is not a correctness bug — it is a **content depth** problem, and it is the single
most important fact about the product right now.

**The design implication is the opposite of what it looks like.** Do not redesign the compact record
to feel richer. The compact template is already honest and complete. What is missing is a *route
from compact to flagship*: **1,266 compact records already carry a `story`** and need only `access`
and `patron` to qualify. That is a visible, finite promotion queue.

Surface it: on `/about` or a new `/coverage` page, publish the live tier counts and the promotion
backlog. Turning the gap into a stated, measurable commitment is more credible than hiding it —
and it is exactly the posture `completeness.ts` already takes at record level.

*Acceptance:* tier counts render from live data, never hardcoded; the page states how many records
are one field away from promotion.

**3.2 — Absent `tier` means flagship.** `resolveTier()` returns `flagship` when `tier` is missing,
and `validate-data.mjs` checks the value is *known* but never that it is *present*. Today that is
safe — all 68 untiered records pass. Prospectively it is a trap: any record added without a `tier`
field silently claims the highest tier. Make `tier` **required** in the validator. See
`CONTENT-CONTRACT.md` §2.

---

## 4. `/sites` — the gazetteer

Measured: **705 KB of HTML uncompressed, 93 KB gzip** — all 2,271 rows prerendered into one
document. It works today and it will not work at 20,000.

Paginate or virtualise, keeping a crawlable path: server-render page 1 plus `rel=next`/`prev`, or
segment by country/state so every record remains reachable by a crawler without a 5 MB document.
Preserve the existing `SiteFilters` behaviour and the `.pagefilters` styling.

*Acceptance:* no gazetteer document exceeds 150 KB gzip; every site reachable from a crawlable link
path; `sitemap.xml` unchanged in coverage.

---

## 5. `/circuits`, `/dynasties`, `/patrons`

These are the atlas's genuine intellectual differentiators and they currently render as card grids.
Give each index a short **cited** standfirst explaining what the taxonomy *is* — a circuit is a
pilgrimage set with its own textual authority; a dynasty attribution is a scholarly claim. The
dynasty vocabulary already hedges honestly (`"Ay or Pandya (attribution disputed)"`,
`"Somavamsi (by local tradition)"`, `"Undetermined"`). **Surface that hedging as a feature** with a
short note on how attributions are qualified, rather than letting it read as untidy data.

Only **555 of 2,271 records (24.4%) carry a circuit** and **27 carry a contested claim**. State the
coverage on the index rather than implying completeness.

---

## 6. `/about` — the methodology page

This page carries the moat. It must state, in plain language, every rule in `CLAUDE.md`: no source →
no publish; history ≠ katha; phones only from official cited sources or a dated call log; automated
drift detection never auto-edits; the Natural Earth India-worldview boundary policy; and the neutral,
dated, cited treatment of contested sites.

Add the honest numbers — corpus size, tier split, independent-source share (11.4%), country
distribution (India is 2,088 of 2,271 = 92%). A reference work that publishes its own coverage gaps
is more citable, not less.

---

## 7. Assistant

Already correct in posture: citations are rendered with equal weight to the answer, absence of a
citation is stated rather than left blank (`.asstnocite`), `aria-modal="false"` so a reader can keep
reading. Two changes: state the corpus-only scope in the opener, and ensure a failed `/api/chat`
call renders a readable error rather than a silent pending state.

---

## 8. Header, drawer, filters

Working well, including a genuinely careful narrow-screen strategy (progressive stat dropping at
1180/920/720/620/560/430px, brand never clipped). No changes beyond the token migration.

---

## 9. Missing states

Add `not-found.tsx` and `error.tsx` at the app root, styled with the existing `.emptystate`
vocabulary. The 404 should offer search and the gazetteer, not a dead end. The map already has
`EmptyState` for zero filter results — reuse the copy register.

*Acceptance:* `/site/does-not-exist` renders a branded 404 with a search affordance; a thrown render
error produces a branded page, not a stack trace.

---

## 10. Priority order

| # | Change | Why first |
|---|---|---|
| 1 | §1.1 client corpus split | Blocks the roadmap; 6× over budget today |
| 2 | Contrast fixes (`DESIGN-TOKENS.md` §2) | Live AA failures, one-line edits |
| 3 | §2.1 katha panel | Rule 3 is currently carried by italics alone |
| 4 | §3.2 require `tier` | Cheap; closes a prospective data trap |
| 5 | §9 404/error | Two files |
| 6 | §2.2 honest verification copy | Removes an over-claim |
| 7 | §1.3 URL state | Makes the atlas shareable |
| 8 | §4 gazetteer paging | Needed before the corpus grows again |
| 9 | §2.3 source prominence, §3.1 coverage page | Surfaces the moat |
| 10 | Fonts, type/space tokens | Foundation; unblocks localisation |
