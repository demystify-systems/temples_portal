# CLAUDE-MD-AMENDMENT.md — Tirtha Atlas

**Status:** proposed amendment to the repo's existing `CLAUDE.md` (currently 7 rules), plus the
propagation matrix and the sequenced task list. **Written against commit `417ffd6`.**

> The existing `CLAUDE.md` is good and should be **extended, not rewritten**. Rules 1–7 stay
> word-for-word. This document adds rules 8–12, a propagation matrix, and a Definition of Done.
> Keep it terse — every line is a recurring token cost on every session.

---

## Part A — Rules to append to `CLAUDE.md`

```markdown
8. **Client payload.** `data/sites.json` must never reach the browser. Client code may import only
   the generated slim map index. A `"use client"` module may not import `@/lib/sites`. Budget: `/`
   total JS ≤ 200 KB gzip, largest chunk ≤ 120 KB. See PERF-A11Y-BUDGET.md.

9. **Tier is required.** Every record carries an explicit `tier` (`stub` | `compact` | `flagship`).
   Absence is a validation error, not an implied flagship. A flagship record carries at least one
   non-Wikimedia source. Promotion happens only by adding a sourced fact.

10. **Tokens, not literals.** Colour, type size and spacing come from `:root` in
    `src/app/globals.css`. No raw hex and no literal px font-size outside that block. Every text
    token clears 4.5:1 and every control-border token clears 3.0:1 against its background in both
    themes; recompute and record the ratio when changing one.

11. **Scripts.** Any record field that may hold a non-Latin script (`native`, and all localised copy)
    renders with `--font-indic`, a `lang` attribute, line-height ≥ 1.65, and no `letter-spacing` or
    `text-transform: uppercase`.

12. **Framing.** Civilisational, never irredentist. Sites outside India are that nation's own
    heritage. Banned in all published copy: "reclaim", "lost lands", "rightful", "Akhand", and
    "occupied" outside a directly cited quotation. Absence of a field is stated as a fact about our
    sourcing, never about the world (see ABSENCE_CLAIM_WORDS) — in every surface, not just the badge.
```

---

## Part B — Single sources of truth

| Concept | SSOT | Never duplicate into |
|---|---|---|
| Record data | `data/sites.json` | client bundles, hardcoded counts, prose |
| Boundaries | `data/geo.json` (Natural Earth `_ind`) | any other geometry source |
| Tier definitions | `data/vocab/tiers.json` | — mirrored *by hand* in `src/lib/completeness.ts`; both change together |
| Design tokens | `:root` in `src/app/globals.css` | component styles, inline styles |
| Era boundaries | `ERAS` in `src/lib/site-utils.ts` | legend copy, timeline, `--e1…e6` comments |
| Canonical host | `src/lib/site-url.mjs` | `next.config.mjs`, metadata, sitemap |
| Coverage stats | `headerStats()` in `src/lib/sites.ts` | `/about`, README, tracker, marketing copy |
| Editorial rules | `CLAUDE.md` | `/about` restates in plain language — keep in sync |

---

## Part C — Propagation matrix

**The rule: change the SSOT → propagate to every dependent in the same change set, or it isn't done.**

| Change | Must also update |
|---|---|
| **New record field** | `Site` type · `validate-data.mjs` REQUIRED/optional · `completeness.ts` FIELD_SCALE + `isSourced` · `tiers.json` · `docs/TIERS.md` · detail template · `jsonld.ts` (only if sourced) · `llms-full.txt` · slim-index builder (only if the map needs it) · Supabase schema + `seed-supabase.mjs` · tests |
| **New records / batch merge** | `npm run validate` · `npm run status:write` (**PHASE2_TRACKER.md is stale — says 1122, actual 2271**) · `reports` · sitemap · slim index · re-check tier distribution |
| **New tier or tier rule** | `tiers.json` · `completeness.ts` (TIER_RANK, TIER_LABEL, FIELD_SCALE) · `docs/TIERS.md` · `validate-data.mjs` · `report-health.mjs` · `Completeness.tsx` copy · `/about` |
| **Era boundary change** | `ERAS` · `--e1…e6` + CVD re-validation + recorded date · legend · timeline ticks · cluster donut arcs · `/about` |
| **New token** | `:root` light **and** both dark blocks · contrast recomputed and recorded · `gate:contrast` · `gate:tokens` allowlist |
| **New public route** | `sitemap.ts` · nav drawer · `llms.txt` · `gate:routes` · breadcrumb JSON-LD |
| **New client component** | check it does not import `@/lib/sites` · `gate:bundle` · `gate:corpus-leak` |
| **New published copy surface** | `gate:absence-words` · `gate:framing` · history≠katha separation preserved |
| **Boundary/geo regeneration** | provenance file (source dataset + date) · `gate:boundaries` · visual check of J&K, Ladakh, Arunachal |
| **New locale** | `--font-indic` subset · `lang` attributes · letter-spacing/uppercase exemptions · localised route + canonical + hreflang · sitemap · citations unchanged (a source is a source) |
| **New env var / integration** | `.env.example` · graceful degradation when unset (pattern: `Assistant` mounts only with `SARVAM_API_KEY`) · README |
| **Contested claim added** | `disputedCircuits` or site-level equivalent with `status`, `note`, `source` · dated cited note in UI · `/about` policy |

**Meta-rule: keep this matrix current.** A change type that isn't listed gets added when it first occurs.

---

## Part D — Definition of Done

A change is done when:
- [ ] `npm run validate && npm run build && npm test` pass
- [ ] Every propagation-matrix row triggered by the change is complete in the same commit
- [ ] New/changed data carries citations; no fact from model memory
- [ ] No new client-bundle weight beyond budget; `gate:corpus-leak` clean
- [ ] Contrast recomputed if any token changed
- [ ] Keyboard path and screen-reader announcement checked for any new interactive element
- [ ] `prefers-reduced-motion` respected by any new motion
- [ ] Both themes checked
- [ ] Generated files regenerated (`status:write`, `reports`, search index, slim index)

---

## Part E — Sequenced task list

Paste these into the VS Code session **one at a time**, in order. Effort is rough solo-developer days.

### Stage 1 — Correctness (≈4 days). Do these first; they are small and they are live defects.

| # | Task | Days | Ref |
|---|---|---:|---|
| 1 | Fix four contrast tokens; record recomputed ratios in `globals.css` | 0.5 | DT §2 |
| 2 | Add `tier` to `validate-data.mjs` REQUIRED; backfill `"flagship"` on the 68 untiered; flip `resolveTier` default to `stub` | 0.5 | CC §2.1 |
| 3 | Add `not-found.tsx` and `error.tsx` using `.emptystate` vocabulary | 0.5 | UX §9 |
| 4 | Katha panel: labelled `<section>`, tinted ground, mono eyebrow, framing line | 1 | UX §2.1 |
| 5 | Honest verification copy; `curated-unverified` never renders as verified | 0.5 | UX §2.2 |
| 6 | Timeline slider `aria-valuetext`; play button accessible name | 0.5 | PA §5.4 |
| 7 | `npm run status:write` — tracker still reports 1,122 sites | 0.25 | — |

### Stage 2 — The architectural fix (≈6 days). Blocks the roadmap.

| # | Task | Days | Ref |
|---|---|---:|---|
| 8 | Build a slim map index at build time (extend `build-search-index.mjs`); target 65 KB gzip | 2 | PA §3.1 |
| 9 | Refactor `AtlasClient` to consume the index; move record prose server-side | 2.5 | UX §1.1 |
| 10 | Dynamically import `Assistant`; audit polyfills | 0.5 | PA §3.2–3.3 |
| 11 | Add `gate:bundle` + `gate:corpus-leak` to CI | 1 | PA §6 |

**Do not start Stage 3 until `/` total JS is under 200 KB.**

### Stage 3 — Foundation (≈7 days)

| # | Task | Days | Ref |
|---|---|---:|---|
| 12 | Load `--font-indic` (Devanagari + Tamil); apply to `.native` with `lang`, line-height, spacing exemptions | 1 | DT §4 |
| 13 | Declare type + spacing scales; migrate opportunistically | 1.5 | DT §5–6 |
| 14 | URL-encoded filter/year state on `/` | 1 | UX §1.3 |
| 15 | Remaining CI gates (contrast, tokens, boundaries, tier, absence-words, framing, routes, theme-mirror) | 2 | PA §6 |
| 16 | CSP after inline-style audit | 1 | PA §3.4 |
| 17 | RUM beacon for Core Web Vitals | 0.5 | PA §3.5 |

### Stage 4 — The moat, made visible (≈6 days)

| # | Task | Days | Ref |
|---|---|---:|---|
| 18 | Source count above the fold; distinguish independent from Wikimedia sources | 1 | UX §2.3 |
| 19 | `/coverage` page: live tier counts, independent-source share (11.4%), country distribution, promotion backlog | 1.5 | UX §3.1 |
| 20 | `/about` rewritten to state all 12 rules in plain language + contested-site editorial policy | 1.5 | UX §6, CC §6 |
| 21 | Transliteration-tolerant search | 1 | UX §1.4 |
| 22 | Cited standfirsts on `/circuits`, `/dynasties`, `/patrons`; surface attribution hedging as a feature | 1 | UX §5 |

### Stage 5 — Scale (≈4 days). Only when the corpus next grows.

| # | Task | Days | Ref |
|---|---|---:|---|
| 23 | Paginate or segment `/sites`, preserving crawlability | 2 | UX §4 |
| 24 | Site-level contested-claim structure (Preah Vihear, Sharada Peeth, Gyanvapi, Krishna Janmabhoomi) | 2 | CC §6 |

### Explicitly NOT doing

- No new palette, no Tailwind, no CSS framework, no map library.
- No sequential era ramp.
- No Khmer/Thai/Burmese/Sinhala font subsets yet.
- No contribution/moderation UI until there is a review cadence to sustain it.
- No diaspora-temple expansion while Afghanistan sits at 3 records.
- No accounts, ratings, social features, or booking.

---

## Part F — The thing the documents cannot fix

The largest finding of this review is not an engineering one.

**Flagship density has fallen from 13.4% (150 of 1,122) to 3.0% (68 of 2,271).** Independent,
non-Wikimedia sourcing sits at **11.4%**. India is **92%** of the corpus. The atlas grew three-fold
in breadth and thinned in depth.

Everything in Stage 4 makes the moat *visible*. Nothing in any of these five documents makes it
*deeper*. **1,266 compact records already carry a `story` and need only `access` and `patron` to
promote** — that is the highest-value queue in the project, and it is research work, not code.

A coding agent will happily execute all 24 tasks and the product will be faster, more accessible and
more honest. It will not be more authoritative. That part is yours.
