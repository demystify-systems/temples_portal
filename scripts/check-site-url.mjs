// Guard: a preview, loopback or malformed host must never reach a canonical URL.
// Chained into `npm run validate`, so CI fails before a bad origin can be indexed.
import assert from "node:assert/strict";
import { canonicalSiteUrl, DEFAULT_SITE_URL } from "../src/lib/site-url.mjs";

const FALLS_BACK = [
  [undefined, "undefined"],
  [null, "null"],
  ["", "empty string"],
  ["   ", "whitespace only"],
  ["not-a-url", "unparseable"],
  ["/relative/path", "relative path"],
  ["ftp://tirthaatlas.org", "non-http protocol"],
  ["javascript:alert(1)", "javascript: scheme"],
  ["https://temples-portal.vercel.app", "the retired production host"],
  ["https://temples-portal-git-main.vercel.app", "a preview deploy"],
  ["https://vercel.app", "vercel.app apex"],
  ["http://localhost:3000", "localhost WITH a port — the .host-vs-.hostname trap"],
  ["http://localhost", "localhost without a port"],
  ["http://app.localhost:8080", "a .localhost subdomain"],
  ["http://127.0.0.1:3000", "IPv4 loopback"],
  ["http://192.168.1.50:3000", "a bare LAN IPv4"],
  ["http://0.0.0.0:3000", "wildcard bind address"],
  ["http://[::1]:3000", "IPv6 loopback"],
];

const PRESERVED = [
  ["https://tirthaatlas.org", "https://tirthaatlas.org", "the canonical origin"],
  ["https://tirthaatlas.org/", "https://tirthaatlas.org", "one trailing slash trimmed"],
  ["https://tirthaatlas.org///", "https://tirthaatlas.org", "several trailing slashes trimmed"],
  ["  https://tirthaatlas.org  ", "https://tirthaatlas.org", "surrounding whitespace trimmed"],
  ["https://www.tirthaatlas.org", "https://www.tirthaatlas.org", "the www host"],
  ["https://tirthaatlas.com", "https://tirthaatlas.com", "the .com host"],
  ["https://tirtha.sivanv.com", "https://tirtha.sivanv.com", "a real custom host"],
];

let failures = 0;
const check = (label, fn) => {
  try { fn(); } catch (e) { failures += 1; console.error(`  ✗ ${label}\n      ${e.message.split("\n")[0]}`); }
};

for (const [input, why] of FALLS_BACK) {
  check(`falls back for ${why}`, () =>
    assert.equal(canonicalSiteUrl(input), DEFAULT_SITE_URL, `${JSON.stringify(input)} should fall back`));
}
for (const [input, expected, why] of PRESERVED) {
  check(`preserves ${why}`, () =>
    assert.equal(canonicalSiteUrl(input), expected, `${JSON.stringify(input)} should normalise to ${expected}`));
}

check("never returns a trailing slash", () => {
  for (const [input] of [...FALLS_BACK, ...PRESERVED]) {
    assert.ok(!canonicalSiteUrl(input).endsWith("/"), `${JSON.stringify(input)} produced a trailing slash`);
  }
});

const total = FALLS_BACK.length + PRESERVED.length + 1;
if (failures) {
  console.error(`✗ site-url guard FAILED — ${failures}/${total} check(s)`);
  process.exit(1);
}
console.log(`✓ site-url guard: ${total} checks passed — no preview or loopback host can reach a canonical URL`);
