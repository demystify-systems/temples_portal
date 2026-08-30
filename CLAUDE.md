# temples_portal — agent constitution

Rules any AI or human contributor must follow in this repo:

1. **Boundary compliance (legal, non-negotiable).** `data/geo.json` must only ever be regenerated from a Natural Earth **`*_admin_0_countries_ind`** (India point-of-view) source. Never use the default worldview: all of J&K, Ladakh (incl. Gilgit-Baltistan, Aksai Chin) and Arunachal Pradesh must render as Indian territory. Sites in Pakistan-occupied J&K are listed with `country: "India"`.
2. **No source → no field → no publish.** Every record in `data/sites.json` carries a non-empty `sources` array. Never fill a fact from model memory; omit it instead. `npm run validate` must pass before any commit.
3. **History ≠ katha.** `significance` holds documented history; `story` holds legend. Never blend them.
4. **Phones** only when published on the site's official website (cited) or call-verified with a dated log. Never copy from listings/blogs.
5. **Detect, don't auto-edit.** The drift/freshness workflows only file issues. A human (or an explicitly instructed session) updates data, with the new citation, in the same commit.
6. **Static-first.** v1 has no runtime DB. Supabase stays dormant until env vars are intentionally set; `data/sites.json` remains canonical even after activation (DB mirrors repo, seeded via `npm run db:seed`).
7. **Design tokens** live in `src/app/globals.css`; the era palette is colour-blind-validated (dark & light) — change it only with a re-validated palette and matching update in `src/lib/sites.ts` era definitions.
8. **Branching: agents push to `develop` and stop there.** Every change is a branch off `origin/develop`, a PR into `develop`, gated green (`npm run validate`, `npm test`, `npx tsc --noEmit`, `npm run build`, plus the e2e job in CI) and merged into `develop`. Promotion to `main` is a human act; no agent performs it.
9. **Promote `develop` → `main` with a MERGE COMMIT, never a squash — and never merge `main` back into `develop`.** These two go together and they are why this repo kept producing conflicts on a promotion that contained no disagreement at all.

   A squash promotion writes develop's changes to `main` as one *new* commit, so develop's own commits never become ancestors of `main`. Nothing is broken yet. The break comes from the next back-merge: merging `main` into `develop` replays that squashed duplicate against the originals it was made from, git sees both sides editing the same lines, and every touched file conflicts — while the two trees are byte-identical. Measured on 2026-08-30: `main` carried squashed duplicates of every promotion and `develop` carried four back-merges of `main`; three separate promotions conflicted, and each resolution was "take develop" on every hunk, ending with `git diff origin/main origin/develop` empty.

   A merge commit keeps `develop` an ancestor of `main`, so the histories never diverge and there is nothing to back-merge. On GitHub: use **Create a merge commit**, not *Squash and merge*, on the promotion PR.

   If a squash promotion happens anyway, do **not** back-merge to repair it. `develop` is already content-identical; fast-forward it onto `main` instead, or leave it and let the next promotion carry the difference.
