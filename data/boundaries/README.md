# State and district boundary layers

Status: **state boundaries ship as an opt-in live overlay. Districts do not ship.**
No boundary file has been added to the repo, deliberately — and `data/geo.json` has
not been touched.

Read this before changing anything about boundaries. It is the record of what was
probed, what was seen with human eyes, and what is still unknown.

---

## 1. The original finding: Natural Earth has no India-POV state layer

`CLAUDE.md` rule 1 / guardrail G1 requires every boundary on this site to follow the
India point of view: all of J&K and Ladakh (including Gilgit-Baltistan and Aksai Chin)
and the whole of Arunachal Pradesh rendered as Indian territory. `data/geo.json`
satisfies this because Natural Earth publishes an India-worldview edition of its
**country** layer:

    ne_10m_admin_0_countries_ind        -> HTTP 200   (what geo.json is built from)

Natural Earth publishes **no such edition of its state/province layer**:

    ne_10m_admin_1_states_provinces     -> HTTP 200   (DEFAULT worldview)
    ne_10m_admin_1_states_provinces_ind -> HTTP 403   (does not exist)

Probed 2026-08-27. So the obvious path — "use the same source one level down" — would
import the **default** worldview: J&K split along the Line of Control, Aksai Chin
excluded, Arunachal shown as disputed. That is precisely the exposure rule 1 exists to
prevent, and it would arrive quietly inside a file named like the one we already trust.

**`ne_10m_admin_1_states_provinces` is therefore banned in this repo.** Not deprecated —
banned. It is the failure mode rule 1 was written for.

---

## 2. What we ship instead: Bhuvan (ISRO/NRSC) WMS, opt-in

### 2.1 The endpoint

    https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms

A GeoServer instance run by the National Remote Sensing Centre, ISRO. Two layers are
registered in `src/lib/layers.ts`:

| Registry id | Bhuvan layer | What it draws |
|---|---|---|
| `india-state-outlines` | `basemap:admin_group_ntl` | State/UT **outlines** with names. Transparent fill. This is the default choice. |
| `india-state-areas` | `state_ql_new` | The same states as **filled** pastel polygons, no names. |

`basemap:inida_state_ql_new` (their typo, not ours) returns bytes identical to
`state_ql_new` and is not registered separately.

### 2.2 Point-of-view verification — done by eye, on 2026-08-28

Provenance alone was not treated as sufficient. Both layers were fetched at crop scale
and **visually inspected**:

- **Jammu & Kashmir / Ladakh** (bbox 71–80.5E, 31.5–37.6N): renders complete. The
  north-western lobe over **Gilgit-Baltistan** is present up to ~37.1N, and **Ladakh**
  extends east across **Aksai Chin** to ~80.4E. `state_ql_new` additionally draws the
  Line of Control as a **dotted internal** line — internal, i.e. inside Indian
  territory, which is the India position. `admin_group_ntl` draws no LoC at all and
  simply shows J&K and Ladakh as two Indian states at full extent.
- **Arunachal Pradesh** (bbox 89–98E, 25.5–30N): renders complete, north to the
  McMahon Line. No "disputed" hatching, no dashed boundary, no truncation.

This is the India point of view, as rule 1 requires. It is also what you would expect
by construction — ISRO is a Government of India body — but "expected by construction"
is not a verification, and the crops are.

**If you register another Bhuvan layer, repeat this. Do not assume the whole catalogue
is consistent.**

### 2.3 Projection: request EPSG:3857, never EPSG:4326

The service's documented example uses `srs=EPSG:4326`, and that call works. **Do not
use it for this map.** EPSG:4326 in a WMS GetMap means plate carrée — linear in
latitude. This atlas is a Mercator (see `GEO` in `src/lib/sites.ts`), so a 4326 image
stretched linearly onto a Mercator rect slides every boundary, worse the further from
the equator: J&K would be tens of pixels out.

Bhuvan's GeoServer answers `srs=EPSG:3857` (and `EPSG:900913`) correctly. Web Mercator
is the same projection as the atlas frame, so a 3857 raster drops onto the matching
content rect with no resampling and no per-row correction. `src/lib/layers.test.ts`
proves the alignment: a coordinate's position inside a built request reproduces the
`PX`/`PY` the map already uses for its 1,100 site marks, to 1e-6 content units.

### 2.4 Dynamic styling is disabled

`SLD_BODY=` (an inline SLD asking for a stroke-only polygon symbolizer) returns bytes
byte-identical to the default style — GeoServer is running with dynamic styles off. So
the raster's own colours cannot be changed at the source, and `globals.css` recolours
it client-side with `filter: brightness(0)` (plus `invert(1)` in dark) instead.

---

## 3. THE LICENCE IS NOT PINNED — and this is why the layer is off by default

Guardrail G11 in `BACKLOG.md`: *Indian government portals carry no open licence …
facts are reusable; prose and photos are not.* A rendered boundary tile is much closer
to their imagery than to a bare fact. `PHASE2.md` pins every other geo source
explicitly (Natural Earth public domain; OSM ODbL kept in a separable layer). Bhuvan
cannot be the one source that ships unpinned.

**Probed 2026-08-28, all failures reproducible:**

| URL | Result |
|---|---|
| `https://bhuvan.nrsc.gov.in/disclaimer.php` | **404** |
| `https://bhuvan.nrsc.gov.in/policy.php` | **404** |
| `https://www.nrsc.gov.in/Open_Data_Archive` | **404** |
| `https://bhuvan.nrsc.gov.in/home/index.php` | 200, but exposes **no** licence / terms / copyright link to a plain fetcher |
| `https://bhuvan-app3.nrsc.gov.in/data/download/index.php` | 200, same — no terms link |

The WMS `GetCapabilities` document reports `<Fees>NONE</Fees>` and
`<AccessConstraints>NONE</AccessConstraints>`. **Do not read that as a grant.** The
same document's `<Title>` is `GeoServer Web Map Service` and its `<Abstract>` is
GeoServer's stock boilerplate — the whole service block is unconfigured defaults, not
a statement NRSC wrote. It is evidence of nothing.

So: **provenance verified, licence unverified.** The consequences, all implemented:

1. Both Bhuvan layers are `defaultOn: false`. A reader opts in per session.
2. The opt-in is **never persisted** — no localStorage, no cookie, no URL parameter.
   Every fresh visit starts with the layers off.
3. Nothing is fetched unless a layer is on. No prefetch, no warm-up request on mount.
   A reader who never opens the Layers panel never touches ISRO's servers.
4. While a layer is on, the panel states in plain words that the layer is served live
   from Bhuvan and its terms are not confirmed for redistribution. It is body text in
   the panel, not a tooltip.
5. The ISRO/NRSC attribution is on screen the whole time a layer is on, panel open or
   closed, and is not dismissible.

`layers.test.ts` enforces points 1 and 4 structurally: a registry entry with
`terms.status: "unconfirmed"` and `defaultOn: true` fails the suite.

**If someone finds a real Bhuvan terms document, that changes this.** Record it here
with the URL and the date, and the default-off decision can be revisited.

---

## 4. Districts: attempted, not shipped

Attempted on 2026-08-28. **No district layer resolves on the public endpoint.**

| Layer name tried | Result |
|---|---|
| `sdv:AP_dist` (and by implication the whole per-state `sdv:*_dist` family) | `ServiceException code="LayerNotDefined"` — *Could not find layer sdv:AP_dist* |
| `basemap:dist_ql_new` | LayerNotDefined |
| `basemap:district_ql_new` | LayerNotDefined |
| `basemap:admin_dist_ntl` | LayerNotDefined |
| `basemap:india_dist` | LayerNotDefined |
| `district_ql_new` | LayerNotDefined |

`sdv:AP_dist` was retried against `bhuvan-vec1`, `bhuvan-vec2` and `bhuvan-vec3`. All
three return the same LayerNotDefined. Earlier notes recording `sdv:*_dist` as the
district path appear to have come from a Bhuvan front-end that reaches a different,
non-public backend; they do not reproduce here.

There is also **no national district layer** under any name tried. Even if the
per-state layers were reachable, districts would mean 36 registry entries plus
per-state bbox routing, which is a different piece of work from this one.

So districts are deferred, and the Layers panel **says so on screen** rather than
leaving the absence to be inferred (`DISTRICT_NOTE` in `src/lib/layers.ts`). The
reader asked for districts; they get the reason, not silence.

---

## 5. Coverage is India-only, and the UI says so

`state_ql_new` and `admin_group_ntl` cover **India and nothing else**. This atlas spans
15 countries. Nepal, Sri Lanka, Bhutan, Cambodia, Indonesia and the rest have states,
provinces and districts; we simply have no India-POV-safe source for them.

The registry carries this as `coverageNote`, and the panel prints it whenever the layer
is on. A reader must never be left to infer that a country drawn without internal lines
has none. `layers.test.ts` fails any entry that declares partial `coverage` without a
`coverageNote`.

---

## 6. Availability is someone else's, and the failure is silent

A live WMS call makes ISRO's uptime our uptime, and Bhuvan is slow from outside India.
Handled in `AtlasClient.tsx`:

- Every tile is preloaded **off-DOM** with `new Image()`. The SVG `<image>` element is
  created only after the bytes have arrived. A 404, a timeout or a dead host therefore
  changes nothing on the map and renders no broken-image glyph anywhere.
- Each request has a 9s timeout (`source.timeoutMs`), after which the transfer is
  cancelled and the layer is marked `unavailable`.
- The only place a reader learns a fetch failed is one line in the Layers panel:
  *"service unreachable — the map is unaffected"*.
- Requests are debounced 400ms after the view settles, snapped to a zoom-scaled grid so
  a small pan reuses the previous URL, and cached by bbox key (64 keys per session).
  A pinch produces one request, not sixty.
- Switching a layer off forgets its cached failures, so switching it back on genuinely
  retries a service that may have recovered.

---

## 7. The three real options for a permanent fix

The overlay is a working answer, not the final one. A vector file we host ourselves
would remove the live dependency, the licence question and the latency in one move.

1. **Bhuvan account + per-state extraction.** Authoritative and unimpeachable. Costs a
   registration and a scripted pull across 36 states/UTs. Slowest, safest. Still leaves
   the licence question open.
2. **Survey of India via data.gov.in.** SoI is the *legal* authority on Indian
   boundaries, so this is arguably stronger than Bhuvan, and NDSAP gives it a licence
   that can actually be cited. Needs someone to confirm the specific dataset, its
   licence terms, and that the download carries the official external boundary.
3. **Patch the default Natural Earth admin_1 layer.** Take the default state geometry
   but override the *external* boundary with the `_ind` country outline already trusted
   in `geo.json`, and hand-verify J&K, Ladakh and Arunachal. Fastest, and technically
   sound because internal state lines in undisputed territory carry no political claim
   — but it makes us the publisher of a boundary we synthesised, which is a real
   liability posture change and should be a deliberate choice, not a default.

**Recommendation: option 2, falling back to option 1.** Do **not** take option 3
without an explicit decision recorded here — the whole point of rule 1 is that this
cannot be decided implicitly by whoever is writing the map code that week.

When a vector source does win, it is **one entry** in `MAP_LAYERS` — the registry
exists so that swapping the source is not a rewrite.

---

## 8. Rules for whoever touches this next

- `data/geo.json` is **never** regenerated for a state or district layer. Everything
  here is additive.
- A new boundary layer needs its point of view **visually verified** at J&K/Ladakh and
  at Arunachal Pradesh, and the crops described in this file, before it is registered.
- A layer whose licence is not pinned ships `defaultOn: false` with its terms position
  stated on screen. The test suite enforces this.
- A layer that covers only part of the atlas ships with a `coverageNote`. The test
  suite enforces this too.
- A missing layer is a feature gap. A wrong boundary is a legal problem. They are not
  comparable, and when in doubt the gap wins.
