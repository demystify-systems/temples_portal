# Scraping briefs for the data session

Division of labour: **the data session owns `data/sites.json` and everything under
`data/`.** The product session owns `src/`, the gate, the schema and the reports, and
never writes the corpus. Hand these over one at a time.

Every brief below was generated from a report in `reports/`, so the counts are measured,
not estimated. Regenerate with `npm run reports` (and `npm run report:coordinates` for the
live Wikidata pass) before starting one, since the corpus moves.

## Rules that apply to every brief

Paste this block at the top of each prompt.

> Read `CLAUDE.md` first. Non-negotiable:
> - **No source → no field → no publish.** Never fill a field from model memory. Omit it.
> - **`significance` is documented history. `story` is legend (katha).** Never blend them,
>   never move text between them.
> - **Phone numbers** only from the temple's own official website (cited) or a dated
>   call-verification log. Never from listings sites, aggregators, or memory.
> - Restate facts in your own words. Never paste Wikipedia prose (CC BY-SA is viral).
> - Wikidata is CC0 and safe to copy values from directly.
> - `npm run validate` must pass before you commit. Warnings are expected; errors are not.
> - Work on a branch off `develop`, never commit to `main`.

---

## Brief 1 — Coordinate corrections (highest value; fixes live map errors)

**Why first:** these are wrong on pages that are already published. Three records sit more
than 40 km from their own cited source.

```
Run `npm run report:coordinates` — it writes reports/coordinates.md with 82 records whose
coordinates carry 2 decimal places or fewer, each looked up live against Wikidata P625 (CC0).

Fix them in data/sites.json. Priority order:

  1. The gross errors first — these are not imprecision, they are wrong points:
     vedaranyeswarar-vedaranyam (109 km from its Wikidata claim)
     kundala-karaneswarar-thirukkurankaval (47 km)
     dwaraka-tirumala (44 km)
     vanamamalai-nanguneri (33 km)
     naguleswaram-keerimalai (16 km)
  2. Then every record where the report marks a strictly more precise candidate (✔).

For each record:
  - Open the linked Wikidata QID and CONFIRM the point sits on the temple, not on the
    village centroid. Some P625 values are themselves centroids — reject those and leave
    the record flagged rather than making it confidently wrong.
  - Update lat/lng to at least 4 decimal places.
  - Append the Wikidata QID to `sources` as {"l":"Wikidata <QID>","u":"https://www.wikidata.org/wiki/<QID>"}.
  - Set `verified` to "wikidata-2026-08-27".

Do NOT change any other field. Re-run `npm run validate` — the coord-precision warning
count must fall, and no ERROR may appear. Report how many you fixed, how many you rejected
as centroids, and which had no P625 at all.
```

---

## Brief 2 — Disputed circuit claimants (correctness, not backlog)

**Why:** two circuits list more members than the tradition recognises. Anyone who knows the
material counts them and concludes we don't. This needs a schema field, not a deletion.

```
`npm run report:circuits` shows two overfull circuits:

  Jyotirlinga    — 14 tagged, canonical 12
  Shakti Peetha  — 55 tagged, canonical 51

These extras are almost certainly genuine DISPUTED claimants, not mistakes. The Jyotirlinga
pair is the classic one: Aundha Nagnath is disputed against Jageshwar, and Vaijnath Parli
against Baidyanath Deoghar. Do not delete anything.

Instead:
  1. For each circuit, determine from cited sources which members are canonical and which
     are disputed claimants. Cite the source that describes the dispute.
  2. Change the `circuits` entry for disputed members from a plain string to:
       {"circuit":"Jyotirlinga","disputed":true,"note":"<one sentence, dated, neutral>","source":"<url>"}
     Keep undisputed members as plain strings. Tell the product session the shape you chose
     so the UI and the gate can be updated to match.
  3. The note must be neutral and dated (guardrail G10). State that the claim exists and who
     makes it. Do not adjudicate which is "real".

Also fix the taxonomy pollution the report lists:
  - "Shakti tradition" (a tradition, not a circuit) — remove from `circuits`.
  - "Maha Shakti Peetha" overlaps "Shakti Peetha" and double-counts members — decide whether
    it is a rank within the parent set rather than a separate circuit.
```

---

## Brief 3 — Circuit completion (51 records)

```
`npm run report:circuits` lists these gaps against the canonical rosters in data/rosters/:

  Paadal Petra Sthalam   242 / 276   (34 missing)
  Sapta Puri               1 / 7     (6 missing)
  Sapta Badri              1 / 7     (6 missing)
  Divya Desam            106 / 108   (2 missing)
  Arupadai Veedu           5 / 6     (1 missing — check which of the six)
  Pancha Bhoota Sthalam    4 / 5     (1 missing — the water element, Thiruvanaikaval)
  Panj Takht               4 / 5     (1 missing)

Two kinds of gap, handle them differently:
  a) The site already exists in data/sites.json but is not tagged — just add the circuit
     to its `circuits` array. Check by name AND by coordinates before concluding it's absent.
  b) The site is genuinely missing — create a full record per data/targets/AGENT_INSTRUCTIONS.md.

Start with Sapta Puri, Sapta Badri, Pancha Bhoota and Arupadai Veedu: they are small,
fixed, famous, and each completed set is immediately usable as a circuit route in the UI.
Paadal Petra's 34 is the long tail — do it last.

After each circuit, re-run `npm run report:circuits` and confirm the gap closed.
```

---

## Brief 4 — Second sources for flagship records (credibility)

**Why:** 970 of 1,122 records (86%) cite Wikipedia and nothing else. The project's pitch is
"the temple site that shows its sources". A reviewer will call it a Wikipedia mirror.

```
`npm run report:sources` lists 86 FLAGSHIP-tier records citing Wikipedia and nothing else.
Flagship records must never be single-sourced.

For each, add at least one non-Wikipedia source and append it to `sources`. Preference order:
  1. Primary — ASI (asi.nic.in), UNESCO WHC, epigraphy corpora, national archaeology depts
  2. Official — the temple's or endowment board's own site (.gov.in, .nic.in, hrce.tn.gov.in,
     tirumala.org, sgpc.net, the devaswom boards)
  3. Scholarly — university, AIIS, JSTOR-indexed, Britannica

Do NOT add tourism blogs, listings sites or aggregators — they rank below Wikipedia, not above.

If a record genuinely has no second source available, leave it and record the id in your
report. An honest "no stronger source exists" is a useful finding; a padded citation is not.

Add the source ONLY if it actually supports the claims in the record. If the ASI page
contradicts our dating, do not quietly cite it — flag the record for the contradiction queue.
```

---

## Brief 5 — Flagship tier completion (depth)

**Why:** 150 records are labelled flagship but only **26 (17%)** carry what the tier promises.

```
See docs/TIERS.md and data/vocab/tiers.json for the contract. Flagship requires:
  significance, story, access, patron — plus a non-Wikipedia source.

Measured gaps across the 150:
  access  missing on 109
  patron  missing on 50

Fill these ONLY from cited sources:
  - `access` — nearest railhead/airport/bus stand with distances, road route, trek or ropeway
    details. From the temple's official site, a state tourism board, or the endowment board.
    Never from memory, never from a travel blog.
  - `patron` — the named ruler, queen, minister, guild or trust who funded construction,
    from the same source that supports the dating.

CRITICAL: do not promote a record by writing plausible access prose. A fabricated access
line is the most damaging possible edit here, because the record looks better and is worth
less — and a pilgrim may act on it. If you cannot source it, leave the field absent and
relabel the record `"tier":"compact"`. Relabelling down to the truth is a correct outcome.

Report: how many you completed to flagship, and how many you relabelled to compact.
```

---

## Brief 6 — Adjudicate the 15 co-located pairs

```
`npm run validate -- --verbose | grep duplicate-coords` lists 15 pairs of records sharing
coordinates to 3 decimal places (~111 m).

MOST OF THESE ARE NOT DUPLICATES and must not be merged. Distinct shrines legitimately share
a compound — the Kanchipuram Divya Desams (Thiruneeragam, Thirukkaragam, Thirukkarvaanam)
sit inside Ulagalantha Perumal; Thirukkalvanur sits inside Kamakshi Amman; Vimala is inside
the Jagannath complex at Puri.

For each pair decide, with a citation, which it is:
  a) Distinct shrines in one complex → keep both. Give each its own precise coordinate if
     the sources support it, so they stop colliding.
  b) One site entered twice → merge, keeping the richer record and the union of `sources`,
     and record the dropped id.

Report the verdict per pair. Do not merge anything you are not certain about.
```

---

## Brief 7 — Native-script names (unblocks the multilingual roadmap)

```
Only 30 of 1,122 records carry `native`. J1/J2 (Hindi and Tamil editions) cannot start
without it, and it is the cheapest multilingual win available.

Fill `native` from Wikidata labels (CC0, safe to copy directly) — query the record's QID
for labels in ta, hi, te, kn, ml, bn, or, mr, gu, ne and take the one matching the site's
own region. Fall back to the native-language Wikipedia article title.

Start with Tamil Nadu (the largest state block and the Paadal Petra / Divya Desam corpus),
then Kerala, Karnataka, Andhra/Telangana, then the north.

Store the script form only — no transliteration, no romanisation. If Wikidata has no label
in the site's regional language, leave it absent.
```

---

## Ordering

1 → 2 → 3 → 4 → 6 → 5 → 7.

Coordinates first because they are wrong in public. Disputed claimants next because they are
a correctness bug that a knowledgeable visitor will spot immediately. Then completion,
sourcing, adjudication, depth, and multilingual groundwork last.
