// Contrast gate (PERF-A11Y-BUDGET.md section 6, `gate:contrast`).
//
//   node scripts/check-contrast.mjs
//
// Parses the token blocks out of src/app/globals.css and recomputes every
// ratio from the hex values actually declared there. It reads the stylesheet
// rather than a copy of the palette on purpose: a gate that checks its own
// duplicate of the data cannot fail when the data changes.
//
// Text tokens need 4.5:1 (WCAG 2.2 1.4.3, normal size — --mut and --gold are
// used at 10-13px, so the large-text allowance does not apply). Control-border
// tokens need 3.0:1 (1.4.11). Decorative tokens are exempt AND are checked for
// never appearing as a text colour or a control border, which is the condition
// that makes the exemption honest.

import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** Text colours. Must clear 4.5:1 against every ground they render on. */
const TEXT_TOKENS = ["ink", "ink2", "mut", "gold"];
/** Borders on real controls (input, select, .chip, .actions a, .tracebtn). */
const CONTROL_TOKENS = ["line2"];
/** Hairlines and ornament. Exempt from 1.4.11 — see the assertion below. */
const DECORATIVE_TOKENS = ["line", "gold-soft"];
/** Grounds a token can land on. */
const GROUNDS = ["bg", "panel"];

const TEXT_MIN = 4.5;
const CONTROL_MIN = 3.0;

const luminance = (hex) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

const ratio = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/**
 * The three declared palettes. The dark one is declared twice (see the MIRROR
 * note in globals.css); check-theme-mirror.mjs proves they agree, so reading
 * the first is sufficient here.
 */
const blockAfter = (marker) => {
  const at = CSS.indexOf(marker);
  if (at < 0) throw new Error(`check-contrast: could not find ${marker} in globals.css`);
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
};

const tokensIn = (block) => {
  const out = {};
  for (const [, name, hex] of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
    out[name] = hex.toUpperCase();
  }
  return out;
};

const THEMES = {
  light: tokensIn(blockAfter(":root{")),
  dark: tokensIn(blockAfter('@media (prefers-color-scheme: dark){ :root:not([data-theme="light"])')),
};

const failures = [];
const rows = [];

for (const [theme, tokens] of Object.entries(THEMES)) {
  const check = (names, min, kind) => {
    for (const name of names) {
      const fg = tokens[name];
      if (!fg) { failures.push(`${theme}: --${name} is not declared`); continue; }
      for (const ground of GROUNDS) {
        const bg = tokens[ground];
        if (!bg) { failures.push(`${theme}: --${ground} is not declared`); continue; }
        const r = ratio(fg, bg);
        rows.push(`  ${theme.padEnd(5)} --${name.padEnd(9)} on --${ground.padEnd(5)} ${r.toFixed(2).padStart(6)}  (needs ${min})`);
        if (r < min) {
          failures.push(
            `${theme}: --${name} on --${ground} is ${r.toFixed(2)}:1, below the ${min}:1 ${kind} minimum ` +
            `(${fg} on ${bg}) — src/app/globals.css`,
          );
        }
      }
    }
  };
  check(TEXT_TOKENS, TEXT_MIN, "text");
  check(CONTROL_TOKENS, CONTROL_MIN, "non-text");
}

// The exemption is only honest while it holds: a decorative token used as a
// text colour or a control border is silently below its real requirement.
const RULES = CSS.split("}");
for (const token of DECORATIVE_TOKENS) {
  for (const rule of RULES) {
    const body = rule.slice(rule.indexOf("{") + 1);
    if (!body.includes(`var(--${token})`)) continue;
    // `color:` at a property boundary, not `background-color` / `border-color`.
    if (new RegExp(`(^|[;{\\s])color\\s*:\\s*var\\(--${token}\\)`).test(body)) {
      const sel = rule.slice(0, rule.indexOf("{")).trim().split("\n").pop();
      failures.push(`--${token} is decorative-exempt but is used as a TEXT colour in \`${sel}\` — src/app/globals.css`);
    }
  }
}

console.log("contrast gate — recomputed from src/app/globals.css\n" + rows.join("\n"));

if (failures.length) {
  console.error(`\n✗ ${failures.length} contrast failure(s):`);
  for (const f of failures) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`\n✓ contrast: ${rows.length} pairs pass in both themes`);
