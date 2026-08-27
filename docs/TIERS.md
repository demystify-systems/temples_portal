# Record tiers

`data/vocab/tiers.json` is the machine-readable source of truth; this file explains it.

A tier is **a promise about which fields are present** — not a quality score, and not a
statement about how important a site is. Kedarnath and a village shrine can both be
flagship; a site is compact because we have not yet sourced its access details, not
because it matters less.

| Tier | Promise |
|---|---|
| `stub` | Placeable and provable: name, coordinates, tradition, a source. |
| `compact` | The essentials: deity, dating, dynasty, style, significance. |
| `flagship` | Reference grade: adds katha, access, patron, and a non-Wikipedia source. |

## The one rule that matters

**A record is never promoted by filling in a field.** Promotion is what happens *after*
a sourced fact is added (CLAUDE.md rule 2, guardrail G2). Writing plausible `access`
prose to move a record from compact to flagship is the single most damaging thing anyone
— human or agent — can do to this project, because it is invisible: the record looks
better and is worth less.

## Where the corpus actually stands

Measured against these definitions at 941 records, the labels do not yet describe the data:

- 150 records carry no `tier` (implying flagship), but only **41** have `access` and
  **100** have `patron`. Real flagship depth is ~41, not 150.
- **410 of 791** compact records carry `story`, which the old framing treated as a
  flagship-only field.

So the first job is not promotion — it is **relabelling to the truth**, then closing the
gap with sourced facts. `npm run report:health` prints current conformance per tier.

## Adding a tier

Don't, unless a genuine field-presence contract is missing. Tiers multiply into UI
branches, gate rules and completeness badges; four tiers is a real cost.
