# PERF-A11Y-BUDGET.md — Tirtha Atlas

**Status:** specification for adoption. **All figures measured against production
`https://tirthaatlas.org` and commit `417ffd6` on 28 Aug 2026.** Audience: Claude Code / VS Code.

---

## 1. Measured baseline (evidence)

### Response
| Route | HTTP | TTFB | HTML (gzip) | HTML (raw) |
|---|---:|---:|---:|---:|
| `/` | 200 | 0.41s | **157 KB** | 424 KB |
| `/sites` | 200 | 0.26s | **93 KB** | 705 KB |
| `/site/brihadisvara-thanjavur` | 200 | 0.18s | 8 KB | 36 KB |
| `/about` | 200 | 0.46s | — | 25 KB |

TTFB is good — static generation on Vercel's CDN is doing its job.

### JavaScript on `/` (compressed, 8 chunks)
| Size | Chunk |
|---:|---|
| **737 KB** | `app/page-90d079648a0647e0.js` |
| 54 KB | `4bd1b696-…` |
| 45 KB | `255-…` |
| 40 KB | `polyfills-…` |
| 3 KB | `176-…` |
| 2 KB | `app/layout-…` |
| 1 KB | `webpack-…` |
| 0 KB | `main-app-…` |
| **885 KB** | **total** |

### Root cause
`src/app/AtlasClient.tsx` is `"use client"` and imports `SITES` from `@/lib/sites`, which does
`import rawSites from "../../data/sites.json"` — **2.67 MB raw / 593 KB gzip**. Webpack inlines the
entire corpus into the page chunk. `page.tsx` passes nothing; the client component pulls the whole
dataset itself.

**Every visitor downloads all 2,271 records — including every `significance` paragraph, `story`,
`access` string and `sources` array — in order to draw dots on a map.**

### Projection
| Corpus | Slim map index (gzip) | Full-corpus bundling (gzip) |
|---:|---:|---:|
| 2,271 (today) | **65 KB** | 593 KB |
| 20,000 (roadmap v0.6) | **568 KB** | **5.1 MB** |

Per-site cost of the slim index: **29 bytes gzip**. Reduction versus bundling: **89.1%**.

**This is the single most consequential engineering finding in the review.** The current
architecture does not reach the roadmap's own next milestone.

---

## 2. Budget

Enforced at the 75th percentile of field data, mid-range Android on 4G — the actual audience.

### Core Web Vitals
| Metric | Target | Note |
|---|---|---|
| LCP | ≤ 2.5s | good threshold |
| INP | ≤ 200ms | replaced FID, March 2024 |
| CLS | ≤ 0.1 | skeletons already sized to real rows — hold that |
| TTFB | ≤ 0.8s | currently 0.18–0.46s ✓ |

### Weight, per route
| Asset | Budget (gzip) | `/` today | Verdict |
|---|---:|---:|---|
| HTML | ≤ 60 KB | 157 KB | **over 2.6×** |
| JS total | ≤ 200 KB | 885 KB | **over 4.4×** |
| Largest single chunk | ≤ 120 KB | 737 KB | **over 6.1×** |
| CSS | ≤ 40 KB | ~15 KB | ✓ |
| Fonts | ≤ 100 KB | 3 Latin families | ✓ — see §4 |
| Initial total | ≤ 400 KB | > 1 MB | **over 2.5×** |

Gazetteer `/sites`: HTML ≤ 150 KB gzip (today 93 KB — passes now, fails at scale; see
`UX-SPEC.md` §4).

---

## 3. Required work, in order

**3.1 — Split the corpus (P0).** Generate a slim map index at build time (extend the existing
`scripts/build-search-index.mjs` pattern). Client gets index only; record prose is server-rendered or
fetched on selection. Target: page chunk ≤ 120 KB.

**3.2 — Audit polyfills (40 KB).** Next 15 targets modern browsers; confirm the `browserslist`
isn't forcing legacy transforms.

**3.3 — Defer the assistant.** `Assistant` mounts in `layout.tsx` on every route when
`SARVAM_API_KEY` is set. Dynamically import it on first interaction so it costs nothing on load.

**3.4 — Add a CSP.** `next.config.mjs` already carries `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options` and `Permissions-Policy`, with a comment noting CSP is deferred pending an audit of
the map's inline styles. Do the audit and ship it.

**3.5 — Field measurement.** No RUM today. Add a lightweight `web-vitals` beacon (or Vercel
Analytics) — the budget above is unenforceable without field data. Lab numbers on a workstation will
not reveal the 885 KB problem's real cost.

---

## 4. Fonts

Three Latin-subset families load today (Marcellus, Hanken Grotesk, IBM Plex Mono).
`DESIGN-TOKENS.md` §4 requires adding Devanagari and Tamil subsets for the **747 records (32.9%)
carrying a `native` field**.

Budget: **≤ 100 KB total**. Add **only** Devanagari and Tamil. Do not speculatively load Khmer, Thai,
Burmese or Sinhala — together they cover under 100 records and OS fallback is adequate.
`next/font` self-hosts and subsets automatically; keep `display: swap` and preload only the display
face.

---

## 5. Accessibility

**Target: WCAG 2.2 AA.**

### Already correct — do not regress
- Full keyboard traversal of the map (`map-keyboard.ts`): Tab, arrows, Home/End, Enter, Escape, with
  a two-tone focus ring drawn at a fixed radius so it stays legible at any zoom over land, water and
  dimmed circuit modes.
- `.crumb` and `.ixrow` converted from click-handling `<span>`/`<div>` to real `<button>`s.
- 44px minimum touch targets via pseudo-element extension, preserving visual size.
- `prefers-reduced-motion` handled globally **and** per-component (the coach mark only animates under
  `no-preference`).
- Skeletons sized from the real rows they replace, so the swap reflows nothing.
- `aria-modal="false"` on the assistant so a reader isn't trapped.
- Cluster glyphs carry `clusterAriaLabel`; era is conveyed by colour **and** text, tradition by shape
  — no single-channel encoding.

This is a genuinely strong accessibility baseline. Most of what a generic audit would flag is done.

### Failures to fix
1. **Contrast.** Light `--mut` 3.08:1 and `--gold` 3.19:1 against `--bg`, both used for normal-size
   text; `--line2` 1.51:1 (light) / 1.88:1 (dark) on form-control borders, against a 3.0 requirement
   for non-text. Fixes in `DESIGN-TOKENS.md` §2. **Live AA failures.**
2. **Indic text semantics.** The 747 `native` values need a `lang` attribute, an Indic-subset font,
   and exemption from `letter-spacing` / `text-transform: uppercase`.
3. **Katha distinction is styling-only** — italic plus a lighter colour. Invisible to assistive
   technology. See `UX-SPEC.md` §2.1.
4. **Timeline slider semantics.** The `<input type=range>` needs `aria-valuetext` announcing the
   formatted year ("1010 CE"), not the raw number, and the play control needs a state-reflecting
   accessible name.
5. **No `not-found.tsx` / `error.tsx`.**

---

## 6. CI gates

Encode each as a script that fails the build with `file:line`. Guidelines get ignored; gates do not.
Where a gate lands on existing violations, grandfather them into a **shrink-only allowlist** — files
outside it may never offend, and a clean file still listed also fails ("stale entry — remove it").

| Gate | Fails when |
|---|---|
| `gate:bundle` | any `/` chunk > 120 KB gzip, or total JS > 200 KB |
| `gate:corpus-leak` | a client chunk contains a `significance` / `story` / `access` / `sources` string |
| `gate:contrast` | any text token < 4.5:1, or control-border token < 3.0:1, in either theme |
| `gate:tokens` | a raw hex or a literal `px` font-size outside `:root` (allowlisted, shrink-only) |
| `gate:boundaries` | `geo.json` provenance is not a Natural Earth `*_ind` worldview source |
| `gate:tier` | any record missing `tier`, or flagship without a non-Wikimedia source |
| `gate:absence-words` | an `ABSENCE_CLAIM_WORDS` term in any published template or copy |
| `gate:framing` | banned irredentist vocabulary (`CONTENT-CONTRACT.md` §6) in any published copy |
| `gate:routes` | any route in `sitemap.xml` returning non-200 |
| `gate:theme-mirror` | the two dark-theme blocks in `globals.css` diverge |

Escape hatches must be **loud and greppable** — an inline `guard-ignore` comment with a reason, or a
pinned `ALLOWED_LINES` entry. Never a silent skip.

Wire into the existing GitHub Actions build+data gate. It runs free on public repos, so there is no
cost argument against adding them.

---

## 7. Definition of done

- [ ] `/` total JS ≤ 200 KB gzip; largest chunk ≤ 120 KB
- [ ] No record prose in any client bundle
- [ ] LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 at p75 on real devices
- [ ] All contrast failures cleared in both themes
- [ ] Indic subsets loaded; `lang` attributes present; fonts ≤ 100 KB
- [ ] Timeline slider announces formatted years
- [ ] 404 and error routes exist and are branded
- [ ] CSP shipped
- [ ] RUM reporting Core Web Vitals
- [ ] All ten gates green in CI
