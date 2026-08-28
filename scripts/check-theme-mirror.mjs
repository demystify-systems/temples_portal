// Theme-mirror gate (DESIGN-TOKENS.md section 7, `gate:theme-mirror`).
//
//   node scripts/check-theme-mirror.mjs
//
// The dark palette is declared twice in globals.css and MUST be identical:
// a media query cannot be overridden by an attribute selector, so
// `:root[data-theme="dark"]` has to restate every value for an explicit
// toggle to beat a light OS preference.
//
// DESIGN-TOKENS.md considered de-duplicating the two blocks and chose this
// check instead, on the grounds that it is a few lines of script and cannot
// break rendering, whereas a clever CSS indirection can. This is that check.

import { readFileSync } from "node:fs";

const PATH = "src/app/globals.css";
const CSS = readFileSync(new URL(`../${PATH}`, import.meta.url), "utf8");

const MEDIA = '@media (prefers-color-scheme: dark){ :root:not([data-theme="light"])';
const ATTR = ':root[data-theme="dark"]';

const lineOf = (index) => CSS.slice(0, index).split("\n").length;

const declarations = (marker, label) => {
  const at = CSS.indexOf(marker);
  if (at < 0) {
    console.error(`✗ theme-mirror: ${label} block not found in ${PATH}`);
    process.exit(1);
  }
  const open = CSS.indexOf("{", at + marker.length - 1);
  const close = CSS.indexOf("}", open);
  const body = CSS.slice(open + 1, close);
  const map = new Map();
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return { map, line: lineOf(at) };
};

const media = declarations(MEDIA, "prefers-color-scheme");
const attr = declarations(ATTR, "data-theme");

const failures = [];
const names = new Set([...media.map.keys(), ...attr.map.keys()]);

for (const name of [...names].sort()) {
  const a = media.map.get(name);
  const b = attr.map.get(name);
  if (a === undefined) failures.push(`--${name} is in the [data-theme="dark"] block (${PATH}:${attr.line}) but missing from the media block (${PATH}:${media.line})`);
  else if (b === undefined) failures.push(`--${name} is in the media block (${PATH}:${media.line}) but missing from [data-theme="dark"] (${PATH}:${attr.line})`);
  else if (a !== b) failures.push(`--${name} diverges: media says "${a}" (${PATH}:${media.line}), [data-theme="dark"] says "${b}" (${PATH}:${attr.line})`);
}

if (failures.length) {
  console.error(`✗ the two dark-theme blocks in ${PATH} have diverged:`);
  for (const f of failures) console.error(`    ${f}`);
  console.error("\n  Every edit to one must be repeated in the other, byte for byte.");
  process.exit(1);
}
console.log(`✓ theme-mirror: both dark blocks declare the same ${names.size} tokens, identically`);
