# DESIGN-TOKENS.md — Tirtha Atlas

**Status:** specification for adoption. **Audience:** Claude Code / VS Code session.
**SSOT:** `src/app/globals.css` `:root` block. Nothing in this document replaces that file — it
constrains how it may change. **Written against commit `417ffd6`.**

> **Read this first.** The token system already exists and is good. Do **not** introduce a new
> palette, do **not** add Tailwind, do **not** add a CSS-in-JS layer. The repo has **zero runtime
> dependencies** (`next`, `react`, `react-dom` only). That is a deliberate asset. Every task below
> is a *correction or extension* of the existing tokens.

---

## 1. Current token inventory (evidence — read from `globals.css`)

Three themes are declared: light `:root`, `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])`, and an explicit `:root[data-theme="dark"]`. The dark block is
**duplicated verbatim** between the media query and the attribute selector.

| Group | Tokens |
|---|---|
| Surface | `--bg` `--water` `--panel` `--panel2` `--line` `--line2` |
| Text | `--ink` `--ink2` `--mut` |
| Accent | `--gold` `--gold-soft` |
| Map | `--land` `--land-ctx` `--cty` |
| Era | `--e1`…`--e6` |
| Effect | `--shadow` `--scrim` |
| Font | `--font-display` `--font-ui` `--font-mono` (injected by `next/font` in `layout.tsx`) |

Type and spacing are **not** tokenised — sizes are literal (`13.5px`, `10.5px`, `21px`) across ~660
lines. That is the main structural gap.

---

## 2. Contrast audit (evidence — computed, WCAG 2.2 relative luminance)

Measured against the real hex values. **This is the highest-priority correction in this document.**

### Light theme
| Pair | Ratio | Verdict |
|---|---:|---|
| `--ink` on `--bg` | 13.33 | AAA |
| `--ink` on `--panel` | 14.43 | AAA |
| `--ink2` on `--bg` | 5.86 | AA |
| `--ink2` on `--panel` | 6.34 | AA |
| **`--mut` on `--bg`** | **3.08** | **FAILS AA for normal text (needs 4.5)** |
| **`--mut` on `--panel`** | **3.33** | **FAILS AA for normal text** |
| **`--gold` on `--bg`** | **3.19** | **FAILS AA for normal text** |
| **`--gold` on `--panel`** | **3.45** | **FAILS AA for normal text** |
| **`--line2` on `--bg`** | **1.51** | **FAILS 1.4.11 non-text (needs 3.0)** |

### Dark theme
| Pair | Ratio | Verdict |
|---|---:|---|
| `--ink` on `--bg` | 14.00 | AAA |
| `--ink2` on `--bg` | 6.98 | AA |
| `--mut` on `--bg` | 3.95 | AA-large only |
| `--gold` on `--bg` | 7.96 | AAA |
| **`--line2` on `--bg`** | **1.88** | **FAILS 1.4.11 non-text** |

**Why it matters (not theoretical).** `--mut` and `--gold` are used at 10–13px — i.e. *normal* text,
not large text — in `.vnote`, `.eyebrow`, `.asstsub`, `.card .cm`, `.hstats`, `.leg .yr`, `.ixrow .yr`,
`.completeness .cnote`, `.asstcount`, `.coach p`. Light-mode `--gold` is also link colour in
`.completeness a` and `.disputed-note a`. `--line2` is the border on every `input`, `select`, `.chip`,
`.actions a` and `.tracebtn` — form-control borders are explicitly in scope for 1.4.11.

**The dark theme is close to compliant; the light theme is not.** Light is the default for most users.

### Required fixes
Change **only these four values**. Do not touch `--ink`, `--ink2`, or any dark-theme value except
`--line2`.

```
Light:  --mut:   #8D8574  →  #6E6757     (target ≥ 4.5 on --bg)
Light:  --gold:  #A97B1F  →  #8A6314     (target ≥ 4.5 on --bg; keep the hue)
Light:  --line2: #C9C1AC  →  #A79E86     (target ≥ 3.0 on --bg)
Dark:   --line2: #3A4560  →  #55618020   (target ≥ 3.0 on --bg — raise lightness, keep hue)
```

Values above are **direction, not gospel**: the agent must recompute the ratio after each change and
land whatever hex clears the threshold with the smallest perceptual shift. `--gold-soft` is
decorative (borders on `.pcount`, `.coach`) and may stay below 4.5 provided it is never used for text.

**Constraint:** `--gold` is the focus-ring colour (`:focus-visible{outline:2px solid var(--gold)}`).
Darkening it *raises* focus-ring contrast, so this change is safe in both directions.

---

## 3. Era palette — leave the hues, fix the documentation

`--e1`…`--e6` map to the six eras in `src/lib/site-utils.ts`:

| Token | Era | Boundary |
|---|---|---|
| `--e1` | Ancient | < 550 |
| `--e2` | Early medieval | < 1000 |
| `--e3` | High medieval | < 1350 |
| `--e4` | Late medieval | < 1650 |
| `--e5` | Early modern | < 1850 |
| `--e6` | Modern | < 2031 |

The palette is **categorical** (gold, blue, red, green, purple, magenta), not a perceptual
light→dark ramp. `CLAUDE.md` rule 7 states it is colour-blind-validated in both themes.

**Do not "improve" this into a sequential ramp.** A sequential ramp would read better as *quantity*
but worse as *category*, and the legend, the cluster donut arcs (`donutArcs` in `src/lib/cluster.ts`)
and the timeline all depend on adjacent eras being *discriminable*, not *ordered*. Colour already
carries era and shape already carries tradition; that dual encoding is correct and satisfies WCAG
1.4.1 because every mark's era is also stated in text in the tooltip, the legend and the sheet.

**Required:** add a comment block above `--e1` recording *which* CVD simulations were run and when,
so rule 7's "re-validated palette" precondition is checkable rather than asserted.

---

## 4. Fonts — the one substantive gap

**Current (`src/app/layout.tsx`):**

```
Marcellus        weight 400          subsets: ["latin"]   → --font-display
Hanken_Grotesk   weights 400–700     subsets: ["latin"]   → --font-ui
IBM_Plex_Mono    weights 400,500     subsets: ["latin"]   → --font-mono
```

**The gap (evidence):** **747 of 2,271 records (32.9%) carry a `native` field** — the name in
Devanagari, Tamil, Telugu, Kannada, Sinhala, Khmer, Thai or Burmese script. It renders in
`.native{color:var(--ink2);font-size:15px}`. **No loaded font subsets any of those scripts**, so all
747 fall through to whatever the OS supplies. On Android WebView that is usually Noto and acceptable;
on Windows it is frequently a clipped or missing-glyph render. The site currently has no control over
a third of its own proper nouns.

This is also the blocker for the Hindi/Tamil roadmap item — you cannot ship a localised UI on a
Latin-only stack.

### Required addition

Add **Noto Sans Devanagari** and **Noto Sans Tamil** (both SIL OFL, both on `next/font/google`) as
`--font-indic`, and apply to `.native` and any localised surface:

```
.native, [lang="hi"], [lang="ta"] {
  font-family: var(--font-indic), var(--font-ui), system-ui, sans-serif;
  line-height: 1.7;   /* NOT the 1.55 body default */
}
```

**Non-negotiable typographic rules for Indic scripts:**
1. **Line-height ≥ 1.65.** The 1.55 body default clips ascending matras and stacked conjuncts.
2. **Never apply `letter-spacing`** to Devanagari or Tamil. It breaks the shirorekha and separates
   conjuncts. Audit: `.brand .t` (`.14em`), `.eyebrow` (`.18em`), `.navitem .nl` (`.05em`),
   `.sect h3` (`.18em`) must all be excluded from any localised rendering.
3. **Never `text-transform: uppercase`** on Indic text — it is a no-op that signals a Latin-only
   assumption. `.eyebrow`, `.sect h3`, `.dates .dl`, `.stat span` all set it.
4. Add only the scripts you actually render. Do not load eight Noto families speculatively —
   see the font budget in `PERF-A11Y-BUDGET.md`.

**Trade-off, stated:** each added subset costs bytes. Devanagari + Tamil covers the large majority of
the 747 (India is 2,088 of 2,271 records). Khmer, Thai, Burmese and Sinhala together cover well under
100 records — **defer those to OS fallback** and revisit only if Southeast Asian coverage deepens.

---

## 5. Type scale — tokenise the literals

Roughly forty distinct literal font-sizes exist. Collapse to a nine-step scale and replace call-sites
mechanically. **Do not redesign the visual result** — pick the nearest step to each existing value so
the rendered page is near-identical, then the scale becomes enforceable going forward.

```
--fs-1:  10px    eyebrows, mono labels, .vnote, .stat span
--fs-2:  11.5px  .srcs li, .chip, .count, .cirrow .yr
--fs-3:  12.5px  .tag, .practical, .coach p, .tracebtn
--fs-4:  13.5px  .sect p, body copy in panels
--fs-5:  15px    .native, .navitem .nl
--fs-6:  16.5px  .card .cn, .patronlist a
--fs-7:  21px    .brand .t, .stat b
--fs-8:  24px    h2.site
--fs-9:  clamp(28px, 4.5vw, 40px)   .page h1
```

Line-heights: `--lh-tight: 1.2` (display), `--lh-body: 1.55`, `--lh-read: 1.7` (`.page p`,
long-form), `--lh-indic: 1.7`.

**Measure:** `.page p` already caps at `68ch`. Keep it. Add the same cap to `.disputed-note li` and
`.srclist li`, which currently run full width.

---

## 6. Spacing scale

Existing padding values cluster around a 4px grid but drift (`9px`, `11px`, `13px`, `18px`, `26px`).
Introduce and migrate to:

```
--sp-1: 4px   --sp-2: 8px   --sp-3: 12px  --sp-4: 16px
--sp-5: 24px  --sp-6: 32px  --sp-7: 48px  --sp-8: 64px
```

Migrate **opportunistically**, not in one sweep — a 660-line stylesheet edited wholesale is a
regression risk with no user-visible payoff. Rule: any block you touch for another reason gets
converted; new blocks must use tokens from the outset. Enforced by the closed-palette gate in
`PERF-A11Y-BUDGET.md` §6.

---

## 7. Theme duplication — deduplicate

The dark palette is written twice, identically. Any future change must be made in both places or the
themes silently diverge. Collapse to one declaration:

```
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* … */ } }
:root[data-theme="dark"] { /* … */ }
```
→ define the values once in a shared custom-property block and reference it, or (simpler, zero-risk)
add a `/* MIRROR: any edit here must be repeated in the block below */` marker on both and a CI check
that the two blocks are byte-identical. **Prefer the CI check** — it is three lines of script and
cannot break rendering.

**Note:** there is no theme *toggle* in the UI — `data-theme` is honoured but nothing sets it. If a
toggle is added, it must set the attribute before first paint or the page flashes. That is a known
class of bug; the repo has no inline head script today.

---

## 8. What NOT to change

- **Do not replace the palette.** It is validated and it works.
- **Do not add Tailwind or any CSS framework.** Zero-dependency is a strategic asset.
- **Do not convert the era hues to a sequential ramp** (§3).
- **Do not restyle the map basemap darker or more saturated.** `--land`/`--water`/`--cty` are
  deliberately low-contrast so era-coloured marks dominate. That is correct.
- **Do not add decorative "Indic" ornament** — no saffron gradients, bells, om glyphs, carved
  borders. The register is a scholarly reference work. Marcellus + Hanken Grotesk + IBM Plex Mono
  already achieves it.

---

## 9. Definition of done

- [ ] All four contrast corrections landed; recomputed ratios recorded in a comment in `globals.css`.
- [ ] No text token below 4.5:1 against `--bg` and `--panel` in **both** themes.
- [ ] No border/control token below 3.0:1 in either theme.
- [ ] `--font-indic` loaded; `.native` renders Devanagari and Tamil without clipping at 1.7 line-height.
- [ ] No `letter-spacing` or `text-transform:uppercase` applies to any element containing Indic text.
- [ ] Type and spacing scales declared in `:root`; new CSS uses them exclusively.
- [ ] CVD validation date recorded above the era block.
- [ ] Dark-block mirror check in CI.
