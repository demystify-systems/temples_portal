// Remove `website` fields that no longer resolve.
//
//   node scripts/prune-dead-websites.mjs            # report only
//   node scripts/prune-dead-websites.mjs --apply    # rewrite data/sites.json
//
// Why this exists: the schema requires `website` to be https, so a record built from
// an article that lists an http-only official site tempts the builder into rewriting
// the scheme — which silently produces a link that does not load. And temple domains
// lapse. Either way the field stops being a source, and CLAUDE.md rule 2 says a field
// with no source does not get published.
//
// A URL is pruned only when the network says so, twice over:
//   • both https:// and http:// fail            → the site is gone
//   • https:// fails but http:// answers        → http-only, unstorable under the schema
// Anything that answers on https is left alone. The Wikipedia source always remains,
// so no record is ever left unsourced by this script.
//
// Default is report-only: --apply is the explicit instruction CLAUDE.md rule 5 wants.

import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITES_PATH = path.join(ROOT, "data", "sites.json");
const apply = process.argv.includes("--apply");
const CONCURRENCY = 6;
const TIMEOUT_MS = 20000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const sites = JSON.parse(readFileSync(SITES_PATH, "utf8"));
const withSite = sites.filter((s) => s.website);

// "Alive" means the host answered — ANY status counts, including 403 and 503.
// Temple sites sit behind CDNs that refuse non-browser clients, and treating that
// refusal as death would have deleted tirumala.org and the Ram Mandir trust's site.
// Only a thrown error (DNS failure, refused connection, TLS failure, timeout) is
// evidence of absence, and even that is retried before it is believed.
const run = promisify(execFile);

// Node's fetch rejects certificate chains that browsers and curl accept — it called
// shrimahakaleshwar.com and annavaramdevasthanam.nic.in dead when both serve 200.
// So a URL is only declared dead once TWO independent clients fail on it.
const curlAnswered = async (url) => {
  try {
    const { stdout } = await run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "20", "-L", "-A", UA, url], { timeout: TIMEOUT_MS + 5000 });
    return stdout.trim() !== "000";
  } catch {
    return false; // curl missing or errored — fall back to the fetch verdict alone
  }
};

const answered = async (url) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
      });
      return true;
    } catch {
      // fall through and retry once
    }
  }
  return curlAnswered(url);
};

const verdicts = [];
const queue = [...withSite];
process.stderr.write(`  checking ${withSite.length} official-site URLs…\n`);

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const s = queue.shift();
    const https = await answered(s.website);
    const http = https ? true : await answered(s.website.replace(/^https:/, "http:"));
    verdicts.push({
      site: s,
      keep: https,
      why: https ? "ok" : http ? "http-only — cannot be stored as https" : "unreachable on http and https",
    });
  }
}));

verdicts.sort((a, b) => a.site.id.localeCompare(b.site.id));
const doomed = verdicts.filter((v) => !v.keep);

console.log(`\nprune-dead-websites — ${withSite.length} records carry a website; ${doomed.length} no longer resolve\n`);
for (const v of doomed) console.log(`  ${v.site.id.padEnd(38)} ${v.site.website.padEnd(48)} ${v.why}`);
if (!doomed.length) console.log("  every official site still resolves.");

if (!apply) {
  console.log(`\n  report only — re-run with --apply to remove these ${doomed.length} website fields\n`);
  process.exit(0);
}

const doomedIds = new Set(doomed.map((v) => v.site.id));
const out = sites.map((s) => {
  if (!doomedIds.has(s.id)) return s;
  const { website, ...rest } = s;
  const sources = (s.sources ?? []).filter((x) => x.u !== website);
  if (sources.length === 0) {
    console.error(`  ✗ ${s.id}: pruning would leave it unsourced — left untouched`);
    return s;
  }
  // A phone may only stand on an official website (CLAUDE.md rule 4); it goes too.
  const { phone, ...kept } = rest;
  if (phone) console.log(`  ${s.id}: phone dropped with the website it stood on`);
  return { ...kept, sources };
});

writeFileSync(SITES_PATH, JSON.stringify(out, null, 1) + "\n");
console.log(`\n  wrote data/sites.json — ${doomed.length} website fields removed\n`);
