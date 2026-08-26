# Tirtha Atlas · temples_portal

**The sacred geography of the Indic world** — an interactive time-map + cited encyclopedia of temples and sacred sites across India, Nepal, Bhutan, Sri Lanka, Pakistan, Afghanistan, Bangladesh, Myanmar, Thailand, Cambodia, Laos, Vietnam, Malaysia, Singapore, and Indonesia. Hindu, Buddhist, Jain, and Sikh traditions; 150 flagship sites in the seed edition, designed to grow to thousands.

Modeled on the ChronosAtlas pattern (map + timeline + typed entity pages), surpassing it with citations on every fact, history separated from legend (*sthala katha*), pilgrim practicalities, and full Indic-sphere coverage.

## Stack

- **Next.js 15** (App Router, TypeScript) — fully **static** in v1: every page is prerendered from `data/sites.json`. No runtime database, no env vars needed to deploy.
- **The atlas** (`/`) — custom SVG map with pan/zoom, a 2,600-year timeline scrubber with era histogram, filters (country / tradition / dynasty / circuit / search), and cited detail panels.
- **Entity pages** — `/site/[slug]` (full cited entry + JSON-LD), `/sites` gazetteer, `/circuit/[slug]`, `/dynasty/[slug]`, `/about`. Sitemap + robots included.
- **Supabase (dormant)** — `supabase/migrations/0001_init.sql` + `npm run db:seed` are ready; activate later by setting env vars (`.env.example`). The repo JSON stays the canonical source; the DB mirrors it for queries and the future contribution queue.

## Map & boundary policy

All maps depict the external boundaries of India **as per the position of the Government of India**: the geometry is built from Natural Earth's **India-worldview edition** (`ne_10m_admin_0_countries_ind`), so the entire UTs of Jammu & Kashmir and Ladakh (including areas under Pakistani and Chinese occupation) and all of Arunachal Pradesh render as Indian territory. Sites in occupied territory (e.g. Sharada Peeth) are listed under India. Regenerate geometry only from a `*_ind` (India POV) Natural Earth source — never from the default worldview.

## Data discipline

- **No source → no field → no publish.** `npm run validate` gates every build (also in CI): required fields, coordinate bounds, non-empty per-record `sources`, phones only alongside an official website.
- History vs **katha** are separate fields, always labelled.
- Phone numbers only from official temple sites (3 in the seed, each verified 2026-08-26).
- 148/150 coordinates Wikipedia-verified on 2026-08-26 (per-record `verified` flag).

## Free-tier automation (GitHub Actions — free for public repos)

| Workflow | Schedule | What it does |
|---|---|---|
| `verify` | every push/PR | data validation gate + full build |
| `wikidata-drift` | weekly | cross-checks coordinates against Wikidata (CC0); files an issue on >2 km drift — **detect-only, humans update data** |
| `source-freshness` | monthly | link-checks every citation; files an issue on dead/moved sources |

Scheduled workflows auto-disable after 60 days without repo activity — any commit keeps them alive.

## Develop & deploy

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # validate + static build
```

Deploy: import the repo in Vercel (zero config — Next.js preset). Optionally set `NEXT_PUBLIC_SITE_URL` to the production URL for canonical sitemap links.

## Licences

- Code: MIT.
- `data/sites.json`: CC BY-SA 4.0 (facts compiled from cited sources; adapted text share-alike).
- Map geometry: Natural Earth (public domain). Coordinates: Wikipedia/Wikidata (CC0).
- Google Maps links use coordinates only; no Google data is stored (Places terms prohibit storing their data).

## Roadmap

Complete the 108 Divya Desams → Wikidata/OSM ingest to thousands of sites (stub pages + verification tiers) → dynasty territory overlays under the timeline → routes/accommodation from official sources only → contribution queue (see `supabase/migrations`) → Indic-language editions.
