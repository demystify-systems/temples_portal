# State and district boundary layers — BLOCKED, and why

Status: **needs a human decision.** No boundary file has been added, deliberately.

## The finding

`CLAUDE.md` rule 1 / guardrail G1 requires every boundary on this site to follow the
India point of view: all of J&K and Ladakh (including Gilgit-Baltistan and Aksai Chin) and
the whole of Arunachal Pradesh rendered as Indian territory. `data/geo.json` satisfies this
because Natural Earth publishes an India-worldview edition of its **country** layer:

    ne_10m_admin_0_countries_ind        -> HTTP 200   (what geo.json is built from)

Natural Earth publishes **no such edition of its state/province layer**:

    ne_10m_admin_1_states_provinces     -> HTTP 200   (DEFAULT worldview)
    ne_10m_admin_1_states_provinces_ind -> HTTP 403   (does not exist)

Probed 2026-08-27. So the obvious path — "use the same source one level down" — would
import the **default** worldview: J&K split along the Line of Control, Aksai Chin excluded,
Arunachal shown as disputed. That is precisely the exposure rule 1 exists to prevent, and it
would arrive quietly inside a file named like the one we already trust.

## Sources checked

| Source | Result |
|---|---|
| Natural Earth admin_1 India POV | **Does not exist** (403) |
| Bhuvan WMS (`bhuvan-vec1.nrsc.gov.in`) | Live, 14,477 layers, authoritative India POV |
| Bhuvan WFS (vector download) | Returns an OWS exception — not openly available |
| Bhuvan district layers | Fragmented **per state** (`sdv:AP_dist`, `sdv:AR_dist`, …), not one national layer |
| data.gov.in | Reachable; specific dataset licence and POV not yet verified |
| datameet/maps (community) | Reachable; POV **not** verified, and it is community-maintained |

Bhuvan is the right answer on the merits — it is ISRO/NRSC, so its boundaries are the
Government of India position by construction. But getting vectors out of it means either
raster WMS tiles (no good for an SVG map that needs paths) or 36 per-state extractions
behind a registration wall.

## The three real options

1. **Bhuvan account + per-state extraction.** Authoritative and unimpeachable. Costs a
   registration and a scripted pull across 36 states/UTs. Slowest, safest.
2. **Survey of India via data.gov.in.** SoI is the *legal* authority on Indian boundaries,
   so this is arguably stronger than Bhuvan. Needs someone to confirm the specific dataset,
   its licence under NDSAP, and that the download carries the official external boundary.
3. **Patch the default Natural Earth admin_1 layer.** Take the default state geometry but
   override the *external* boundary with the `_ind` country outline already trusted in
   `geo.json`, and hand-verify J&K, Ladakh and Arunachal. Fastest, and technically sound
   because internal state lines in undisputed territory carry no political claim — but it
   makes us the publisher of a boundary we synthesised, which is a real liability posture
   change and should be a deliberate choice, not a default.

## Recommendation

Option 2, falling back to option 1. Do **not** take option 3 without an explicit decision
recorded here — the whole point of rule 1 is that this cannot be decided implicitly by
whoever is writing the map code that week.

Until then, no state or district layer ships. A missing layer is a feature gap; a wrong
boundary is a legal problem.
