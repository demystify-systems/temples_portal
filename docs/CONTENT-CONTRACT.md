# CONTENT-CONTRACT.md — Tirtha Atlas

**Status:** specification for adoption. **Written against commit `417ffd6`, corpus 2,271 sites.**
**Relationship to `CLAUDE.md`:** that file states the rules; this file makes them **checkable** and
records where the corpus currently stands against each.

> These are the rules that protect the only defensibility the project has. A change that violates one
> is not a trade-off to be weighed — it is out of scope.

---

## 1. Sourcing

**Rule (`CLAUDE.md` 2):** no source → no field → no publish. Never fill a fact from model memory.

**Current state (evidence):**
- 2,271 records, **0 with an empty `sources` array**. The rule is holding.
- Sources per record: 873 have 1, 1,299 have 2, 99 have 3. **Maximum is 3.**
- Host concentration: `en.wikipedia.org` 2,294 · `wikidata.org` 1,165 · `whc.unesco.org` 45 ·
  everything else in single digits (`tntemplesproject.in` 9, `karnatakatourism.org` 8,
  `tamilnadutourism.tn.gov.in` 7, `britannica.com` 6, `hrce.tn.gov.in` 5, `asi.nic.in` 3 …).
- **Independent (non-Wikimedia) source coverage: 260 of 2,271 = 11.4%.**

**The honest read.** The citation *mechanism* is real and enforced. The citation *substance* is
thin: this is presently a well-provenanced Wikipedia mirror. That is genuinely more than any
competitor offers — none of them cite at all — but "every fact is cited" and "every fact is cited to
Wikipedia" are different claims, and only the first is currently being made in the copy.

**Required:**
1. Never state or imply independent scholarly sourcing corpus-wide. Publish the 11.4% figure.
2. `tiers.json` already expects a non-Wikipedia source at flagship tier; **66 of 68 flagship records
   meet it.** Hold that line — it is the one place the deeper claim is true.
3. Treat independent-source share as the project's primary content KPI, ahead of record count.

**Gate:** every record has ≥1 source with a non-empty `u`. *(Already enforced.)*
**New gate:** a record whose resolved tier is `flagship` must have ≥1 non-Wikimedia source. Currently
warn-only in `report-health.mjs`; promote to error once the 2 stragglers are fixed.

---

## 2. Tier integrity

**Rule:** a tier is a promise about which fields are present. Never a quality judgement. A record is
promoted only by adding a **sourced** fact (`data/vocab/tiers.json`).

**Current state (evidence):**

| Tier | Count | Share |
|---|---:|---:|
| flagship (encoded as *absent* `tier`) | 68 | 3.0% |
| compact | 2,203 | 97.0% |
| stub | 0 | 0% |

All 68 flagship records satisfy `story` + `access` + `patron`. 66 also carry an independent source.
**No current integrity failure.**

**Two problems, both prospective:**

**2.1 — Absence encodes the *highest* tier.** `resolveTier()` returns `flagship` for a missing
`tier`; `validate-data.mjs` line 81 checks the value is recognised but never that it is present, and
`tier` is absent from the `REQUIRED` array. A new record written without a `tier` therefore silently
claims flagship and then fails its own promise. Given that records arrive in automated batches of
~46, this will happen.

**Required:** add `tier` to `REQUIRED` in `validate-data.mjs`, backfill `"flagship"` onto the 68, and
change `resolveTier()`'s default to `stub` — so the failure mode becomes *under*-claiming.

**2.2 — Density is falling.** At 1,122 sites: 150 flagship (13.4%). At 2,271: 68 (3.0%). The corpus
doubled and the deep records did not. **1,266 compact records already carry a `story`** and need only
`access` and `patron` to promote — a finite, addressable queue.

**Required:** publish tier counts live (never hardcoded); set an explicit target for flagship share
and report against it in `report-health.mjs`.

---

## 3. History ≠ legend

**Rule (`CLAUDE.md` 3):** `significance` holds documented history; `story` holds legend. Never blend.

**Current state:** `significance` on 2,271 (100%); `story` on 1,334 (58.7%). `jsonld.ts` honours the
rule correctly — `significance` becomes the `Place` description and `story` appears only inside an
explicitly legend-labelled FAQ answer, never concatenated. That is exemplary.

**The weakness is presentational,** not structural: on the page the distinction is carried by
`font-style: italic` and a lighter text colour alone. See `UX-SPEC.md` §2.1 for the required labelled
panel.

**Gates:**
- No template may render `significance` and `story` inside one text node or one paragraph.
- The katha block must carry a visible textual label and an accessible name — not styling alone.
- Any new surface that displays record prose (assistant answers, OG images, `llms-full.txt`,
  future exports) must preserve the separation. **`llms.txt` / `llms-full.txt` are published
  surfaces and are in scope.**

---

## 4. Contact data

**Rule (`CLAUDE.md` 4):** phones only from the official website (cited) or a dated call-verification
log. Never from listings or blogs.

**Current state:** `phone` on 63 of 2,271 (2.8%); `website` on 144 (6.3%). The restraint is correct
and should not be relaxed to improve a coverage statistic.

**Gate:** every record with a `phone` must also carry a `website` or an explicit dated call-log
reference. **Additionally:** never store or cache Google Places contact or hours data — it may only
ever be a live per-request lookup, never a repository asset.

---

## 5. Boundaries

**Rule (`CLAUDE.md` 1, legal, non-negotiable):** `data/geo.json` may only be regenerated from a
Natural Earth `*_admin_0_countries_ind` (India point-of-view) source. All of J&K, Ladakh (incl.
Gilgit-Baltistan and Aksai Chin) and Arunachal Pradesh render as Indian territory. Sites in
Pakistan-occupied J&K are listed with `country: "India"`.

**Gate:** the geo build script must refuse any source filename or worldview property that is not the
`ind` variant, and record the source dataset and date in a committed provenance file. This must fail
the build, not warn.

---

## 6. Contested claims

**Rule:** dated, cited, neutral prose. Display the dispute; never resolve it silently.

**Current state:** 27 records carry `disputedCircuits`, with `status`, `note` and `source`, rendered
via `.chip-disputed` (dashed) and a cited note. The Baidyanath/Vaijnath Jyotirlinga dispute is handled
by giving *both* claimants an entry. This is the right pattern.

**Required:** extend the same treatment to contested *sites* (Preah Vihear, Sharada Peeth, Gyanvapi,
Krishna Janmabhoomi), not only contested circuit membership. Write the editorial policy into
`/about` **before** traffic arrives.

**Framing gate — banned language.** Civilisational, never irredentist. The Southeast Asian sites are
each nation's own heritage. Ban across all published copy: "reclaim", "lost lands", "rightful",
"Akhand", "occupied" (outside a directly cited quotation), and any phrasing that frames a site in
another sovereign state as belonging to India. This is both an ethical line and a commercial one —
it is what keeps the atlas citable in all 15 countries and welcome in app stores.

---

## 7. Automation posture

**Rule (`CLAUDE.md` 5):** detect, don't auto-edit. Drift and freshness workflows file issues; a human
updates data with the new citation in the same commit.

**Watch item:** `verified` values show 2,102 records stamped `wikipedia-2026-08-27` — a single bulk
pass. That is legitimate *source-checking*, but the field name reads as *verification*. Rename or
re-render so automated checking is never presented as human verification (`UX-SPEC.md` §2.2). The 2
`curated-unverified` records must not display as verified under any template.

---

## 8. Absence language

`src/lib/completeness.ts` exports `ABSENCE_CLAIM_WORDS` — `unknown`, `unavailable`, `not available`,
`no data`, `n/a`, `none`, `missing`, `lost to history` — banned from field labels and badge copy,
enforced by `completeness.test.ts`. The reasoning is exactly right: an absent field means *we have
not sourced it*, never *the fact does not exist*.

**Required:** widen the ban from the badge to **all published copy** — page templates, empty states,
`/about`, assistant responses, OG images. Same word list, one shared guard.

---

## 9. Scope

India is **2,088 of 2,271 records (92%)**. Outside India: Indonesia 32, Cambodia 21, Thailand 19,
Nepal 17, Sri Lanka 17, Myanmar 15, Pakistan 14, Bangladesh 11, Bhutan 9, Vietnam 8, Malaysia 8,
Singapore 5, Laos 4, **Afghanistan 3**.

"15 countries" is true but thin. Either deepen the non-India coverage or describe the scope more
precisely. Presenting a 92%-India corpus as a pan-Indic atlas is the kind of overclaim that a
journalist or an academic reviewer will find first.

**Do not** expand to diaspora temples (US, UK, Africa, Fiji, Caribbean) before the existing 15
countries are credible. It would dilute the centre while the periphery is still at single digits.

---

## 10. The gate summary

| Gate | Rule | State |
|---|---|---|
| Every record ≥1 source | 2 | enforced |
| `tier` present and recognised | — | **value checked, presence not — fix** |
| Flagship has non-Wikimedia source | tiers.json | 66/68 — promote to error |
| `significance` / `story` never merged | 3 | enforced in JSON-LD; extend to all surfaces |
| Phone implies official website or call log | 4 | **add** |
| No Google Places data stored | — | **add** |
| geo.json from `_ind` worldview only | 1 | **add — must fail build** |
| Banned irredentist framing | — | **add** |
| Absence-claim words in all copy | — | badge only — widen |
| Contested sites carry dated cited note | 6 | circuits done; sites **add** |
