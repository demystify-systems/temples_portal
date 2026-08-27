# Tirtha Atlas — Phase 2 handoff

Read this file **and `CLAUDE.md`** before making any change. `CLAUDE.md` holds the
non-negotiable rules (map boundary compliance, no-source-no-publish, history vs katha,
phone verification, detect-don't-auto-edit). This file holds the current state and the
Phase 2 work queue.

## Where things stand (27 Aug 2026)

| Item | State |
|---|---|
| Database | **688 sites**, 15 countries, 71 states/provinces, 22 circuits — `data/sites.json` |
| Tiers | 150 flagship (full history + katha + access) · 538 compact (essentials, marked `"tier":"compact"`) |
| Sourcing | Every record cites its own Wikipedia article; 37 carry official websites; 3 carry official phone numbers |
| Pages | 934 statically generated (site / circuit / dynasty / gazetteer / about) |
| Map | Natural Earth **India-worldview** geometry — J&K, Ladakh (incl. Gilgit-Baltistan, Aksai Chin) and Arunachal render as Indian territory. **Never regenerate from the default worldview.** |
| Deploy | Vercel project `temples-portal` (team `demystify-systems`), auto-deploys on push to `main` |
| CI | `verify` (data gate + build) per push; `wikidata-drift` weekly; `source-freshness` monthly — all free on public-repo Actions |

## Running it locally

```bash
git clone https://github.com/demystify-systems/temples_portal.git
cd temples_portal
npm install          # Node 20+ (developed on 22); no env vars needed — v1 is fully static
npm run dev          # http://localhost:3000
npm run build        # runs the data validation gate, then the static build
npm run validate     # data gate alone — must pass before every commit
```

There is no database, no API key, and no secret required to run or build. `.env.example`
exists only for the dormant Supabase layer (Phase 3).

## Phase 2 work queue, in priority order

### 0. Unified hamburger navigation + header rebuild  ← do this first, it is user-facing

**The problem today:** the home page (`src/app/page.tsx`) renders the nav as a row of pill
buttons (Index / Gazetteer / Circuits / About & sources) that wrap onto two or three rows on
narrow screens and crowd the stats row; the content pages use a completely different text-link
row inside `PageShell` (`src/app/ui.tsx`). Two different navs, neither of which holds up on mobile.

**What to build:** one shared header component used by **every** page.

- **Hamburger button top-left**, beside (or replacing) the brand mark — visible at all
  breakpoints, not just mobile. Opens a menu/drawer containing: Atlas map, Gazetteer,
  Circuits, Dynasties, About & sources. Mark the current page as active.
- Extract a single `<SiteHeader>` component (e.g. `src/app/SiteHeader.tsx`, client component)
  and use it in `src/app/page.tsx` **and** in `PageShell` in `src/app/ui.tsx`. Delete the
  two divergent nav implementations. The header must look and behave identically everywhere.
- **Index** is atlas-only state, not a route — keep it in the menu but have it toggle the
  gazetteer panel when on `/`, and navigate to `/sites` from any other page. (Today it is
  wired through a fragile `document.getElementById("ixbtn")` listener in `AtlasClient.tsx` —
  replace that with a proper prop/callback or a small shared store while you are in there.)
- **Header layout:** brand left (with the hamburger), stats row (`688 sites · 15 countries ·
  4 traditions · 30 centuries`) should collapse to a single line and drop the least important
  items — or move under the brand — before it ever wraps to three rows. On phones show at most
  two stats. The tagline already hides below 920px; keep that.
- Accessibility: the toggle needs `aria-expanded` and `aria-controls`, the drawer needs a
  focus trap and `Esc` to close, and it must close on route change and on backdrop click.
  Respect `prefers-reduced-motion` for the open/close transition.
- Keep the existing design tokens in `src/app/globals.css` — gold accent, Marcellus display
  face, both light and dark themes. Verify in **both** themes at 390px, 768px and 1440px.

Acceptance: no wrapped pill rows at any width; identical header on `/`, `/sites`,
`/circuits`, `/dynasties`, `/about`, and `/site/[slug]`; keyboard-operable menu.

### 1. Finish the push to 1,000+ sites
289 curated targets remain, already batched and ready:
`data/targets/agent_batch_15.json` … `agent_batch_21.json` (46/46/46/46/46/46/13).

Per-batch procedure (one subagent per batch, 2–3 batches in parallel is a good pace):
- Follow `data/targets/AGENT_INSTRUCTIONS.md` **exactly** — it defines the record schema
  and the skip rules.
- One Wikipedia article per target → coordinates, dating, dynasty, deity, style,
  significance, official website if the article lists one.
- **No article or no coordinates from any source → skip the record.** Never invent a
  coordinate or a date. ~60 targets were correctly skipped in waves 1–2 for this reason.
- Budget 2–4 tool calls per target. DBpedia hard-throttles after ~10 requests; `mapcarta`
  via WebSearch (`allowed_domains: ["mapcarta.com"]`) is the one reliable coordinate
  fallback, and every slug hit must be checked against the expected district — same-named
  places in other states are a real trap.
- Write output to `data/batches/records_<NN>.json`, flushing every ~15 targets so an
  interruption doesn't lose work.

Then merge with the dedupe script pattern used in waves 1–2: match on normalised name
**and** on coordinates rounded to 3 dp (catches the same site under a different name),
auto-suffix colliding ids, drop malformed records, and re-run `npm run validate`.

### 2. Coordinate precision pass
Some compact records carry village-centre rather than temple-precise coordinates.
Sweep them against Wikidata P625 (CC0) and correct with a citation. The
`wikidata-drift` workflow already flags >2 km divergence weekly — work its issues.

### 3. Deepen compact records into flagship tier
For the highest-traffic sites, add the `story` (sthala katha), `access`, `patron`, and
`originNote` fields. Keep history and legend in their separate fields — never blended.

### 4. Circuit completion
Verify full membership counts against the canonical rosters in `data/rosters/`
(Divya Desam 108, Paadal Petra Sthalam ~276, Shakti Peetha 51) and fill the gaps.
Then add ordinal positions so circuits can render as ordered yatra routes.

### 5. Features from the blueprint
Dynasty territory overlays under the timeline · circuit route mode · Commons photo layer
(store per-file licence + author) · Hindi/Tamil editions · then Phase 3: activate Supabase
(`supabase/migrations/0001_init.sql`, `npm run db:seed`) and build the contribution queue.

## Guardrails that must not slip

- `npm run validate` gates the build. A record with no `sources` cannot ship.
- Phone numbers only from an official temple website (cited) or a dated call-verification log.
- Google Places may **not** seed the database — 30-day cache limit, place IDs only. Use it
  as a live per-request lookup keyed on a stored `google_place_id`, nothing more.
- OSM data is ODbL (share-alike at the database layer) — keep it in a separable layer.
- Facts get restated in our own words; Wikipedia prose is not copied.
