/**
 * Feature flags. Env-driven, off unless switched on, and pure enough to test.
 *
 * A flag exists so that unfinished work can live on `develop` without being
 * live. It is not a config system: there is no runtime store, no per-user
 * targeting, no remote fetch. `NEXT_PUBLIC_` values are inlined by Next at build
 * time, so a flag is fixed for the lifetime of a deployment — which is what a
 * static-first site wants (constitution rule 6), and why an unset or misspelt
 * value must fail closed rather than guess.
 *
 * To add one: add the field to `FLAGS`, read it through `parseFlag`, and
 * document the env var in `.env.example`.
 */

/**
 * The spellings that mean "on". Everything else — unset, "", "0", "false",
 * "maybe", "ON PLEASE", a stray newline from a CI secret — means off.
 *
 * Deliberately a closed list rather than a truthiness check: `Boolean("false")`
 * is `true`, which is exactly how a flag gets switched on by accident.
 */
const TRUTHY = new Set(["1", "true", "on", "yes"]);

/**
 * Read one env value as a flag. Absent, empty or unrecognised is `false`.
 *
 * Takes the value rather than the variable name so it is a function of its
 * argument and can be tested without mutating `process.env` — the same reason
 * `site-utils.ts` keeps the corpus out of its own helpers.
 */
export const parseFlag = (raw: string | undefined | null): boolean =>
  typeof raw === "string" && TRUTHY.has(raw.trim().toLowerCase());

export type Flags = {
  /**
   * Is /support published?
   *
   * OFF (the default) — the page renders, and says plainly that the project is
   * not accepting donations. It carries `noindex` while it is off, and it is
   * absent from `sitemap.ts`, so nothing links to it and nothing indexes it.
   *
   * Turn it on only once the commercial posture is actually decided. It gates
   * publication, not payment: there is no payment provider chosen and no payment
   * code anywhere in this repo, in either state of this flag.
   */
  readonly support: boolean;
};

/**
 * The flags this deployment was built with.
 *
 * `process.env.NEXT_PUBLIC_*` has to be written as a literal member expression
 * for Next to inline it — destructuring `process.env` or indexing it with a
 * variable silently yields `undefined` in the browser bundle.
 */
export const FLAGS: Flags = Object.freeze({
  support: parseFlag(process.env.NEXT_PUBLIC_SUPPORT_PAGE),
});
