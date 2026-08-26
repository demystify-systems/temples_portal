# temples_portal — agent constitution

Rules any AI or human contributor must follow in this repo:

1. **Boundary compliance (legal, non-negotiable).** `data/geo.json` must only ever be regenerated from a Natural Earth **`*_admin_0_countries_ind`** (India point-of-view) source. Never use the default worldview: all of J&K, Ladakh (incl. Gilgit-Baltistan, Aksai Chin) and Arunachal Pradesh must render as Indian territory. Sites in Pakistan-occupied J&K are listed with `country: "India"`.
2. **No source → no field → no publish.** Every record in `data/sites.json` carries a non-empty `sources` array. Never fill a fact from model memory; omit it instead. `npm run validate` must pass before any commit.
3. **History ≠ katha.** `significance` holds documented history; `story` holds legend. Never blend them.
4. **Phones** only when published on the site's official website (cited) or call-verified with a dated log. Never copy from listings/blogs.
5. **Detect, don't auto-edit.** The drift/freshness workflows only file issues. A human (or an explicitly instructed session) updates data, with the new citation, in the same commit.
6. **Static-first.** v1 has no runtime DB. Supabase stays dormant until env vars are intentionally set; `data/sites.json` remains canonical even after activation (DB mirrors repo, seeded via `npm run db:seed`).
7. **Design tokens** live in `src/app/globals.css`; the era palette is colour-blind-validated (dark & light) — change it only with a re-validated palette and matching update in `src/lib/sites.ts` era definitions.
