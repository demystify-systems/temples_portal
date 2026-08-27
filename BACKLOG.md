# Tirtha Atlas — Master Backlog & Enhancement Plan
### Everything that can be built, in one place · compiled 27 Aug 2026

> **How to use this document.** This is the full universe of work for the project — far
> more than any one sprint. Read it alongside `CLAUDE.md` (non-negotiable rules) and
> `PHASE2.md` (the immediate queue). Each task has an ID, a rationale, acceptance
> criteria, dependencies and a rough size: **S** = hours · **M** = 1–3 days ·
> **L** = 1–2 weeks · **XL** = multi-week. Nothing here should be started before the
> guardrails section is understood — several tasks are legally or ethically constrained.

---

## 0. Where the project stands today

| Dimension | Current state |
|---|---|
| Database | 688 sites · 15 countries · 71 states/provinces · 22 circuits · `data/sites.json` |
| Record tiers | 150 flagship (history + katha + access + patron) · 538 compact (essentials) |
| Sourcing | 100% of records cite a Wikipedia article · 37 official websites · 3 verified phone numbers |
| Coordinates | 148/150 flagship Wikipedia-verified; compact tier mixed article/gazetteer precision |
| Site | Next.js 15 static · 934 prerendered pages · site/circuit/dynasty/gazetteer/about |
| Map | Custom SVG, Natural Earth **India-worldview** geometry, pan/zoom, era timeline scrubber |
| Deploy | Vercel `temples-portal` (team demystify-systems), auto-deploy on push to `main` |
| CI | verify (data gate + build) · wikidata-drift (weekly) · source-freshness (monthly) |
| Database layer | Supabase schema written, **dormant** — repo JSON is canonical |
| Cost | ₹0/month at current scale |

**Target end-state:** the definitive, citation-backed encyclopedia and interactive atlas
of the sacred Indic world — tens of thousands of sites, community-maintained, multilingual,
with a pilgrim layer accurate enough to plan a yatra from, and an API other products build on.

---

## 1. Guardrails — read before touching anything

| # | Rule | Why |
|---|---|---|
| G1 | Map geometry **only** from a Natural Earth `*_admin_0_countries_ind` (India POV) source. All of J&K, Ladakh (incl. Gilgit-Baltistan, Aksai Chin) and Arunachal render as Indian territory. | Legal exposure in India |
| G2 | **No source → no field → no publish.** Never fill a fact from model memory. Omit instead. | The product's entire moat |
| G3 | Documented history (`significance`) and legend (`story`) stay in separate, labelled fields. Never blend. | Credibility with scholars and press |
| G4 | Phone numbers only from an official temple website (cited) or a dated call-verification log. Never from listings sites or model memory. | Wrong numbers at scale actively harm pilgrims |
| G5 | Google Places data may **not** be stored — 30-day coordinate cache limit, place IDs only, no display on non-Google maps. Live per-request lookup only. | Contract breach; verified in 2026 terms |
| G6 | OSM is ODbL — share-alike is contagious at the **database** layer. Keep OSM-derived geometry in a separable layer with "© OpenStreetMap contributors". | Licence contamination of the core DB |
| G7 | Wikipedia text is CC BY-SA (viral). Restate facts in our own words; never paste prose. Wikidata is CC0 and safe. | Licence hygiene |
| G8 | UNESCO descriptions need written permission to republish. Coordinates and facts are free; their prose is not. | Verified in their syndication terms |
| G9 | Automation **detects**, humans **decide**. Crons file issues; they never auto-edit published facts. | Prevents silent corruption at scale |
| G10 | Contested sites (Preah Vihear, Sharada Peeth, Gyanvapi, Krishna Janmabhoomi) get dated, cited, neutral prose. Framing is civilisational, never irredentist. | Geopolitical and community safety |
| G11 | Indian government portals (HR&CE, TMS, Incredible India) carry no open licence and geo-block foreign IPs. Facts are reusable; prose and photos are not. Scrape from India-hosted infra. | Legal + practical |

---

## 2. EPIC A — Navigation, header & core UX

| ID | Task | Detail | Size |
|---|---|---|---|
| A1 | **Unified hamburger navigation** | One `<SiteHeader>` for every page. Hamburger top-left, drawer with Atlas/Gazetteer/Circuits/Dynasties/About, active-state marking, focus trap, Esc-to-close, closes on route change. Kills the wrapping pill row and the divergent `PageShell` nav. | M |
| A2 | Header stats responsive collapse | `688 sites · 15 countries · 4 traditions · 30 centuries` must never wrap to 3 rows; show 2 stats max on phones. | S |
| A3 | Replace the `getElementById("ixbtn")` nav hack | The Index toggle is wired via a DOM listener across components — replace with a prop/callback or small shared store. | S |
| A4 | Mobile map ergonomics | Bottom-sheet detail panel instead of side drawer on phones; larger tap targets on marks (min 44px hit area); pinch-zoom polish. | M |
| A5 | Marker clustering | At 1k+ sites the map is dense. Cluster by proximity at low zoom with counts, expanding on zoom-in. Must preserve era colour + tradition shape semantics. | L |
| A6 | Timeline enhancements | Era band click-to-jump, keyboard arrow scrubbing, a "sites built in this era: N" readout, and a play-speed control. | M |
| A7 | Detail panel polish | Sticky header inside the panel, prev/next navigation between filtered results, share button (copies the `/#site=` deep link). | M |
| A8 | Empty & loading states | "No sites match these filters" with a one-click reset; skeleton while the map hydrates. | S |
| A9 | Onboarding hint | First-visit coach mark on the timeline scrubber (the single least-discoverable feature). Dismissible, remembered in localStorage. | S |
| A10 | Keyboard navigation | Tab through markers in filtered order, Enter to open, Esc to close. Currently mouse-only. | M |
| A11 | Print/PDF stylesheet | A temple page should print cleanly as a one-page reference for pilgrims without connectivity. | S |

## 3. EPIC B — Data scale (the road from 688 to 50,000)

| ID | Task | Detail | Size |
|---|---|---|---|
| B1 | **Finish batches 15–21** | 289 curated targets already batched. → ~950–1,000 sites. | M |
| B2 | Complete the canonical circuits | Verify against `data/rosters/`: Divya Desam 108, Paadal Petra Sthalam ~276, Shakti Peetha 51, Jyotirlinga 12, Char Dham, Panch Kedar, Ashtavinayak, Navagraha, Pancharama, Sapta Puri, Panj Takht, Ashta Lakshmi, Chausath Yogini, Pancha Bhoota, Arupadai Veedu. Fill every gap. | L |
| B3 | **Wikidata bulk ingest** | SPARQL for `wdt:P31/P279* wd:Q842402` (Hindu temple) + Buddhist/Jain/gurdwara classes, filtered to the 15-country bbox, with P625 coordinates. CC0 — the safest large source. Expect 20–30k candidates. Land as `tier: "stub"`. | L |
| B4 | **OpenStreetMap ingest** | Overpass/Geofabrik: `amenity=place_of_worship` + `religion=hindu\|buddhist\|jain\|sikh`. India alone: 43,239 hindu / 1,328 sikh / 1,091 buddhist / 672 jain (Geofabrik taginfo, Aug 2026). Keep in a **separable ODbL layer** (G6). Join to Wikidata via the `wikidata=*` tag. | L |
| B5 | ASI protected-monument layer | ~3,698 centrally protected monuments (PDF list, no coords) joined to Wikidata coordinates via the Bhuvan/ISRO import (`github.com/prachatos/asi-wikidata`, MIT). Adds the authoritative "protected" flag. | M |
| B6 | TN HR&CE ingest | 43,800+ temples with deity, timings, officer contacts. Same NIC ITMS software as Karnataka Muzrai (~34,500) — one scraper covers both. **Needs India-hosted runner** (geo-blocked). | XL |
| B7 | AP TMS + Telangana Endowments | Per-temple portals with sevas, accommodation, booking links, 6(a)/6(b)/6(c) importance tier. | L |
| B8 | Kerala Devaswom boards | ~3,000 temples across Travancore/Cochin/Malabar/Guruvayur. TDB publishes no roster — RTI or a direct data request is the realistic path. | L |
| B9 | Southeast Asia depth | CISARK (4,000+ Khmer sites, Cambodia MCFA+EFEO), Thailand Fine Arts Dept (~5,700 listed), Sri Lanka gazetted monuments (via the 25 tabulated Wikipedia district lists), Nepal DoA, Indonesia Cagar Budaya registry. | L |
| B10 | Stub-page UX | A stub must never look broken: "This temple exists in our gazetteer — help complete it" with the contribution CTA and whatever fields exist. | M |
| B11 | Deduplication engine | At 10k+ scale, name+coordinate matching isn't enough. Fuzzy name matching across transliterations (Sri/Shri/Shree, -eshwar/-ishwara), 500m coordinate clustering, and a human review queue for ambiguous pairs. | L |
| B12 | Data tier taxonomy | Formalise `stub` → `compact` → `flagship` with explicit field requirements per tier, surfaced as a completeness badge on each page. | S |

## 4. EPIC C — Verification & data quality

| ID | Task | Detail | Size |
|---|---|---|---|
| C1 | Coordinate precision pass | Some compact records carry village-centre coordinates. Sweep against Wikidata P625; correct with citation. Track precision level per record (`exact` / `approximate` / `locality`). | L |
| C2 | Expand the drift cron | Currently coordinates only. Add inception-date and official-website drift; batch issues weekly by severity. | M |
| C3 | Contradiction detection | Flag records where our date, dynasty or deity disagrees with Wikidata/Wikipedia — a review queue, not an auto-fix (G9). | M |
| C4 | Source tiering | Rank citations: primary (inscription/ASI/UNESCO) > scholarly (AIIS/academic) > encyclopedic (Wikipedia) > editorial (tourism). Show the strongest source per fact; prioritise upgrading weak ones. | M |
| C5 | Per-field provenance | Move from per-record to per-field citations, so "built 1010 CE" and "42 m vimana" each carry their own source. Schema exists in the blueprint (`site_dating.source_id`). | L |
| C6 | Field-verification queue | Sites flagged for on-ground checking (currently 2). Contributors with GPS can resolve them. | M |
| C7 | Automated data-health dashboard | Internal page: coverage by state/tradition/era, tier distribution, records missing coordinates/dates/sources, staleness histogram. | M |
| C8 | Retraction/correction log | Public changelog of corrected facts with dates — the credibility instrument Wikipedia has and no temple site does. | M |

## 5. EPIC D — Content depth

| ID | Task | Detail | Size |
|---|---|---|---|
| D1 | Promote compact → flagship | Add `story` (katha), `access`, `patron`, `originNote` for the top ~300 most-visited sites. | XL |
| D2 | Architecture sections | Per-site: plan type, vimana/shikhara height, mandapa count, material, sculptural programme — the vocabulary that makes it a reference work. | L |
| D3 | **Inscription layer** | Digitised *South Indian Inscriptions* + *Epigraphia* (public domain volumes; `inscriptions.whatisindia.com`). Attach primary-source dating and patronage to Chola/Pandya/Hoysala/Kakatiya temples. **No competitor has this.** | XL |
| D4 | Festival calendar | Per-site annual festivals with lunar-calendar computation (Panchang), so "what's happening at this temple next month" is answerable. | L |
| D5 | Deity taxonomy | Structured deity entities (Shiva → Nataraja → Chidambaram) with their own pages, iconography notes, and cross-site links. | L |
| D6 | Dynasty entity pages | Real content per dynasty: period, extent, architectural signature, temple list, map of holdings — not just a filtered list. | M |
| D7 | Architectural style pages | Nagara/Dravida/Vesara/Kalinga/Kerala/Maru-Gurjara/Khmer/Newar/Javanese/Cham with diagrams and exemplar sites. | L |
| D8 | Sampradaya & tradition context | Shaiva/Vaishnava/Shakta/Smarta, Theravada/Mahayana/Vajrayana, Digambara/Svetambara — properly explained, correctly tagged. | M |
| D9 | "Sacred geography" essays | Long-form: why the Jyotirlingas map the subcontinent, how Chola temples exported Dravida style to Angkor, the Shakti Peetha body-map. Editorial that earns links and press. | L |
| D10 | Ramayana/Mahabharata trails | Sites keyed to epic episodes across India, Nepal and Sri Lanka — a highly searched, poorly served category. | M |

## 6. EPIC E — Media

| ID | Task | Detail | Size |
|---|---|---|---|
| E1 | Wikimedia Commons photo layer | Per-file licence + author stored and displayed. WLM India seeded 100k+ monument photos. Start with the flagship 150. | L |
| E2 | Image pipeline | Responsive sizes, AVIF/WebP, blur placeholders, CDN. At 1k+ sites this decides page weight. | M |
| E3 | Contributed photography | Upload → moderation → Commons-compatible licensing. Requires EXIF GPS validation against the site coordinate. | L |
| E4 | 360°/panorama support | Where Commons or contributors provide equirectangular images. Dinamalar does this for Tamil temples; it's a visible differentiator. | M |
| E5 | Architectural drawings | Plans and elevations from public-domain ASI volumes and Fergusson/Cousens surveys. | L |
| E6 | AIIS metadata linkage | Link to the American Institute of Indian Studies photo archive records (expert dynasty attributions) without hosting their images. | M |

## 7. EPIC F — The pilgrim layer (your "routes, stay, contacts" ask)

| ID | Task | Detail | Size |
|---|---|---|---|
| F1 | Structured access data | Nearest railhead/airport/bus stand with distances, road route, trek details, ropeway/palki/heli options where they exist. | L |
| F2 | Darshan timings & queue types | Opening hours, aarti/puja schedule, free vs paid darshan, special-entry queues. From official sites only. | L |
| F3 | **Official booking deep links** | TTD, SMVDSB, BKTC, Sabarimala virtual queue, SJTA, Guruvayur — link only to **official** systems, never aggregators. Add a prominent "beware fraudulent puja sites" note (SJTA itself warns about this). | M |
| F4 | Accommodation — official first | Temple trust guest houses, dharamshalas, TTD/SMVDSB bhawans, state tourism lodges. Commercial listings, if ever, clearly separated and non-monetised at first. | L |
| F5 | **Verified contact registry** | Phone/email/booking numbers with `source_url`, `verification_method` (official-site / call-verified), `last_verified_at`, and a 12-month re-verification cycle. This is G4 made into a system. | L |
| F6 | Live "open now" widget | Google Places lookup at request time keyed on a stored `place_id` — never cached, never stored (G5). Shows current hours + phone from Google, clearly attributed. | M |
| F7 | Social presence links | Official Facebook/Instagram/YouTube pages per temple, stored as contribution-verified contact rows (your ask). Validate the handle actually belongs to the temple trust. | M |
| F8 | Dress code & entry rules | Non-Hindu entry restrictions (Guruvayur, Puri, Pashupatinath inner courtyard), dress codes, photography rules, mobile-phone bans. Genuinely useful and frequently searched. | M |
| F9 | Accessibility info | Wheelchair access, lift availability, senior-citizen queues, step counts for hill temples. Underserved everywhere. | M |
| F10 | Seasonal status | Kedarnath/Badrinath/Amarnath/Hemkund open-close dates, monsoon closures, yatra registration windows. | M |
| F11 | Crowd guidance | Best-time-to-visit by day/season/festival, drawn from published footfall and festival dates. | M |

## 8. EPIC G — Circuits & yatra planning

| ID | Task | Detail | Size |
|---|---|---|---|
| G1 | Circuit mode on the map | Select Jyotirlinga → the 12 light up, numbered, others dim, with an ordered list panel. | M |
| G2 | Ordinal positions | `site_circuit.position` so circuits render as ordered routes, not sets. | S |
| G3 | Yatra route planner | Multi-site itinerary with stage distances, travel time, and suggested day splits. Start with the fixed classical circuits. | XL |
| G4 | Custom trip builder | User picks sites → optimised order → printable/shareable itinerary. Needs no login if URL-encoded. | L |
| G5 | Circuit completion tracking | Let a pilgrim mark sites visited (localStorage first, account later) — the single strongest reason to return to the site. | M |
| G6 | Regional mini-circuits | Kashi Panchakroshi, Braj Chaurasi Kos, Ashta Vinayaka day-loops, Chardham-by-road stages. | L |

## 9. EPIC H — Chronology & visualisation

| ID | Task | Detail | Size |
|---|---|---|---|
| H1 | **Dynasty territory overlays** | As the timeline scrubs, show Chola/Vijayanagara/Khmer/Pala extents. The "empire builds temples as it expands" demo — the single most distinctive feature available to this project. | XL |
| H2 | Construction-activity chart | Temples built per century by region/dynasty — reveals the great building booms and the destruction gaps. | M |
| H3 | Style-diffusion map | Animate how Dravida travels from Pallava Kanchi → Chola → Angkor → Java. Directly serves the civilisational thesis. | L |
| H4 | Destruction & restoration layer | Honestly documented: Somnath, Martand, Bamiyan, Nalanda, Kashi, Mathura, Angkor's abandonment, 2015 Nepal earthquake, 2001 Bamiyan. Dated, cited, neutral (G10). | L |
| H5 | Patron network graph | Which rulers/queens/ministers/guilds funded what, across sites. Ahilyabai Holkar alone links Kashi, Gaya, Somnath, Grishneshwar, Vishnupad. | L |

## 10. EPIC I — Search & discovery

| ID | Task | Detail | Size |
|---|---|---|---|
| I1 | Real search engine | Postgres FTS now, Typesense/Meilisearch at 10k+. Typo tolerance and transliteration-aware. | L |
| I2 | Multi-script search | "மீனாட்சி", "मीनाक्षी" and "Meenakshi" must all find Madurai. | M |
| I3 | Near-me / geo search | "Temples within 50 km" — PostGIS `ST_DWithin`, or client-side at current scale. | M |
| I4 | Faceted browse | Combine era + tradition + style + state + circuit + UNESCO status with counts per facet. | M |
| I5 | Comparison view | Two or three temples side by side — dates, dynasty, style, size. | M |
| I6 | "Random tirtha" | Serendipity; surprisingly effective for engagement and for surfacing stubs that need work. | S |

## 11. EPIC J — Multilingual

| ID | Task | Detail | Size |
|---|---|---|---|
| J1 | i18n infrastructure | Next.js routing (`/hi/`, `/ta/`), locale-aware metadata, hreflang. Do this **before** translating anything. | L |
| J2 | Hindi + Tamil first | Largest audiences, and Tamil unlocks the Paadal Petra/Divya Desam corpus. | XL |
| J3 | Native-script names | Already partially present (`native` field) — complete it for all records. | M |
| J4 | Telugu, Kannada, Malayalam, Bengali, Odia, Marathi, Gujarati, Nepali | Ordered by database coverage. | XL |
| J5 | Community translation workflow | Translation as a first-class contribution type with the same review queue. | L |

## 12. EPIC K — Community contribution (your core ask)

| ID | Task | Detail | Size |
|---|---|---|---|
| K1 | Auth | Supabase Auth, email/OTP + Google. Anonymous suggestions allowed but queued lower. | M |
| K2 | Contribution queue | Table exists in `supabase/migrations/0001_init.sql`. Build submit → review → approve/reject → publish, with evidence required per submission. | L |
| K3 | Three contribution lanes | **Open** (photos, timings, festivals, route tips, contact corrections) · **Editor** (history, dating, dynasty — citation required) · **Institutional** (verified temple-trust owners manage their own practical data). | L |
| K4 | Provenance chips | Every field shows: official · scholar-reviewed · community-verified · unverified stub. | M |
| K5 | Moderation dashboard | Queue triage, bulk actions, contributor reputation, abuse flags. | L |
| K6 | Contributor profiles & credits | Public attribution — the reputation ladder that kept Wikipedia alive. | M |
| K7 | Phone-verification workflow | Contributor claims a number → logs call date/outcome → second verifier confirms → published with `last_verified_at`. Directly implements G4. | L |
| K8 | Edit history & rollback | Per-record version history, diffs, one-click revert. | L |
| K9 | Talk/discussion pages | Wikipedia's most underrated feature — where contested facts get resolved in public. | L |
| K10 | Institutional onboarding | Outreach kit for temple trusts and state boards to claim their listings. Also the succession path for aging solo corpora (TempleNet, Hello Angkor, HistoricalGurudwaras). | M |

## 13. EPIC L — Backend activation

| ID | Task | Detail | Size |
|---|---|---|---|
| L1 | Stand up Supabase | Apply `0001_init.sql`, `npm run db:seed`. Repo JSON stays canonical; DB mirrors it. Mumbai region (`ap-south-1`). | M |
| L2 | PostGIS enablement | Geospatial queries: nearest, within-radius, bbox, circuit routing. | M |
| L3 | Full normalised schema | Migrate from the flat `sites` table to the blueprint's `site` / `site_dating` / `narrative` / `practical` / `contact` / `source` / `media` / `external_id` model. | XL |
| L4 | ISR strategy | At 10k+ pages, full static builds get slow. Move to on-demand ISR with revalidation webhooks from the DB. | L |
| L5 | RLS policies | Public read, contributor write to queue only, service-role for moderation. | M |
| L6 | Backup & DR | Automated DB snapshots + the repo JSON as an independent recovery path. | S |

## 14. EPIC M — API & platform

| ID | Task | Detail | Size |
|---|---|---|---|
| M1 | Public read API | REST + GeoJSON, key-based rate limiting. **The licensing product** — the funded devotion apps (Sri Mandir $53M, Utsav ₹36 Cr) have no knowledge layer and would rather integrate than build one. | L |
| M2 | Embeddable map widget | `<iframe>`/script embed for state tourism sites, temple trusts, blogs — distribution + backlinks. | L |
| M3 | Bulk data downloads | CC BY-SA dumps (CSV/JSON/GeoJSON) — reciprocity for the open data the project consumes. | M |
| M4 | Wikidata write-back | Contribute verified coordinates and IDs back to Wikidata (CC0). Good citizenship, and it compounds. | M |
| M5 | MCP server | Let AI assistants query the atlas directly — a natural fit given the repo's tooling. | M |

## 15. EPIC N — SEO, growth & content marketing

| ID | Task | Detail | Size |
|---|---|---|---|
| N1 | Structured data expansion | Already emitting Place/HinduTemple JSON-LD. Add Event (festivals), BreadcrumbList, ImageObject, FAQPage. | M |
| N2 | OG image generation | Per-site social cards (`@vercel/og`) with name, era colour, and location. | M |
| N3 | Internal linking | Related sites by circuit/dynasty/style/region already partially done — extend to deity and patron. | S |
| N4 | Core Web Vitals | The map bundle is the risk at scale. Budget: LCP < 2.5s on 4G. | L |
| N5 | Custom domain | Buy and wire `tirthaatlas.org` / `.in`. Add the `canonicalSiteUrl()` backstop so a stale env var can never leak a retired host. | S |
| N6 | Editorial calendar | The essays from D9 published on a cadence, seasonally timed (Kumbh, Char Dham opening, Thaipusam, Vesak). | L |
| N7 | Press & academic outreach | The citation discipline is the story: "the temple site that shows its sources". | M |

## 16. EPIC O — Engineering quality

| ID | Task | Detail | Size |
|---|---|---|---|
| O1 | Test suite | Vitest for data transforms, Playwright for map interaction, deep links, filters, mobile nav. | L |
| O2 | Visual regression | Screenshot diffing on the map and key pages, both themes. | M |
| O3 | Accessibility audit | WCAG 2.1 AA. Map keyboard access (A10) is the big gap; also colour-blind verification of the era palette (already validated — keep it validated). | L |
| O4 | Error monitoring | Sentry or Vercel observability; a client error on the map is currently invisible. | S |
| O5 | Analytics | Privacy-respecting (Plausible/Umami). Which temples, which circuits, which filters — this drives the D1 prioritisation. | S |
| O6 | Performance budget in CI | Fail the build if the JS bundle or page weight regresses past a threshold. | M |
| O7 | Data-layer typing | Generate TS types from the Supabase schema once L1 lands; today `Site` is hand-maintained. | S |
| O8 | India-hosted scraper runner | Small Mumbai VM (₹500–1,000/mo) registered as a **self-hosted GitHub Actions runner** (free) for the geo-blocked government portals. Unblocks B6/B7/B8. | M |

## 17. EPIC P — Mobile & apps

| ID | Task | Detail | Size |
|---|---|---|---|
| P1 | PWA | Installable, offline shell, cached temple pages — genuinely useful where pilgrims have no signal. | L |
| P2 | Offline circuit packs | Download a circuit (maps + pages + contacts) before travelling. | L |
| P3 | Native wrapper | Capacitor iOS/Android if PWA distribution proves insufficient. Store-release constraints are non-trivial. | XL |

## 18. EPIC Q — AI features (only where they earn their place)

| ID | Task | Detail | Size |
|---|---|---|---|
| Q1 | Semantic search | Embeddings over significance/katha text: "temples where a king did penance". | L |
| Q2 | Draft-assist for contributors | Pre-fill a stub from its Wikipedia article, **always** as a draft for human review — never auto-published (G9). | M |
| Q3 | Translation assist | Machine first pass, native-speaker review before publish. | M |
| Q4 | Ask-the-atlas | Q&A grounded strictly in the cited database, with citations shown and refusal when unsourced. Must never hallucinate a temple. | L |

## 19. EPIC R — Sustainability

| ID | Task | Detail | Size |
|---|---|---|---|
| R1 | Cost model by scale | Current ₹0. At 50k sites + ISR + images: Supabase Pro $25 + Vercel $20 + CDN + scraper VM ≈ $70–100/mo. Model it before it arrives. | S |
| R2 | Donation/patronage | Wikipedia-style, non-intrusive. | M |
| R3 | API licensing tiers | Free/attribution tier + commercial tier (M1). | M |
| R4 | Institutional partnerships | State tourism boards, temple trusts, universities — grants and data-sharing rather than ads. | L |
| R5 | Governance plan | Who arbitrates contested facts, what the editorial policy is, how the project survives its founder. The graveyard (Temple 360, TempleNet, Jinalaya) is full of one-person projects. | M |

---

## 20. Suggested release phasing

| Release | Contents | Outcome |
|---|---|---|
| **v0.3** (now) | A1–A3, B1, F3 | Fixed navigation, ~1,000 sites, official booking links |
| **v0.4** | B2, C1, E1, G1–G2, A5 | Complete circuits, photos, circuit mode, clustering |
| **v0.5** | L1–L2, K1–K2, I1 | Database live, contributions open, real search |
| **v0.6** | B3–B5, B10–B12, L4 | Wikidata+OSM+ASI ingest → 20k+ sites with stub UX |
| **v0.7** | F1–F5, F8–F10 | The pilgrim layer, verified contacts |
| **v0.8** | J1–J2, D1 | Hindi + Tamil, 300 flagship records |
| **v1.0** | H1, D3, M1–M2, N5 | Dynasty overlays, inscriptions, public API, custom domain |
| **Beyond** | B6–B9, P1–P2, Q1–Q4, R2–R5 | Government registries, offline, AI, sustainability |

## 21. Decisions that need Siva, not code

1. **Name & domain** — "Tirtha Atlas" is the working title. Register before v1.0 (N5).
2. **Licence for the dataset** — currently CC BY-SA. CC0 maximises reuse and Wikidata write-back; BY-SA protects reciprocity. Pick deliberately.
3. **Commercial posture** — pure public-good (donations/grants) vs API licensing to the funded devotion apps. Changes the schema's attribution requirements.
4. **Editorial policy on contested sites** — written down before traffic arrives, not during a controversy.
5. **Government partnership appetite** — an HR&CE or state-tourism MoU would unlock B6–B8 legitimately rather than by scraping.
6. **Scope discipline** — the Indic sphere is already enormous. Resist Hindu temples in the global diaspora (US/UK/Africa/Fiji) until the core is deep, or the project loses its centre.
