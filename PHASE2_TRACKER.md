# Phase 2 tracker

> **Generated file — do not hand-edit.** Regenerate with `npm run status:write`.
> Every figure is read from `data/targets/`, `data/batches/` and `data/sites.json`,
> so a claimed batch that never landed shows up as such.

## Database

| | |
|---|---|
| Sites | **1122** (goal 1000+ — reached) |
| Countries | 15 |
| Circuits | 28 |
| Tiers | 150 flagship · 972 compact |
| Unsourced records | 0 ✓ |

## Record batches

| Batch | Targets | Built | In database | State | Output written |
|---|---:|---:|---:|---|---|
| 01 | 46 | 44 | 44 | merged | 2026-08-27 02:58 |
| 02 | 46 | 44 | 44 | merged | 2026-08-27 02:58 |
| 03 | 46 | 33 | 33 | merged | 2026-08-27 02:58 |
| 04 | 46 | 43 | 43 | merged | 2026-08-27 02:58 |
| 05 | 46 | 45 | 45 | merged | 2026-08-27 02:58 |
| 06 | 46 | 45 | 45 | merged | 2026-08-27 02:58 |
| 07 | 46 | 39 | 39 | merged | 2026-08-27 02:58 |
| 08 | 46 | 37 | 37 | merged | 2026-08-27 02:58 |
| 09 | 46 | 22 | 22 | merged | 2026-08-27 02:58 |
| 10 | 46 | 28 | 28 | merged | 2026-08-27 02:58 |
| 11 | 46 | 40 | 40 | merged | 2026-08-27 02:58 |
| 12 | 46 | 40 | 40 | merged | 2026-08-27 02:58 |
| 13 | 46 | 46 | 46 | merged | 2026-08-27 02:58 |
| 14 | 46 | 41 | 41 | merged | 2026-08-27 02:58 |
| 15 | 46 | 37 | 37 | merged | 2026-08-27 03:26 |
| 16 | 46 | 36 | 36 | merged | 2026-08-27 03:25 |
| 17 | 46 | 38 | 38 | merged | 2026-08-27 03:26 |
| 18 | 46 | 45 | 45 | merged | 2026-08-27 03:26 |
| 19 | 46 | 41 | 40 | built, not merged | 2026-08-27 03:28 |
| 20 | 46 | 45 | 45 | merged | 2026-08-27 03:25 |
| 21 | 13 | 13 | 13 | merged | 2026-08-27 03:21 |
| 22 | 65 | 63 | 62 | built, not merged | 2026-08-27 03:52 |
| 23 | 65 | 52 | 52 | merged | 2026-08-27 03:50 |
| 24 | 65 | 60 | 60 | merged | 2026-08-27 03:50 |
| **all** | **1128** | **977** | **975** | | |

Targets not built are the ones correctly **skipped**: no Wikipedia article, no
coordinates from any source, or already in the database. Skipping is the required
behaviour — `CLAUDE.md` rule 2, no source → no field → no publish.

## Gates

```bash
npm run validate   # data gate — every record sourced, in bounds, well formed
npm run build      # validate, then the static build (all pages prerendered)
npm run status     # this tracker, printed
```
