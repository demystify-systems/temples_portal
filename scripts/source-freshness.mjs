// Monthly source-freshness sweep: HEAD/GET every cited URL, record status.
// DEAD (>=400 / network fail) and MOVED (30x to a different host) are reported.
// DETECT ONLY — a human re-verifies and updates citations; the cron never edits data.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const sites = JSON.parse(readFileSync(new URL("../data/sites.json", import.meta.url)));
const urls = [...new Set(sites.flatMap((s) => [...s.sources.map((x) => x.u), s.website].filter(Boolean)))];
const UA = "TirthaAtlas/0.1 (temples_portal; citation freshness bot)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = { checkedAt: new Date().toISOString(), total: urls.length, dead: [], moved: [], ok: 0 };
for (const u of urls) {
  try {
    const res = await fetch(u, { method: "GET", redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (res.status >= 400) out.dead.push({ u, status: res.status });
    else if (new URL(res.url).host !== new URL(u).host) out.moved.push({ u, to: res.url });
    else out.ok++;
  } catch {
    out.dead.push({ u, status: "network/timeout" });
  }
  await sleep(700); // polite
}
mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
writeFileSync(new URL("../reports/source-freshness.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`ok ${out.ok}/${out.total} · dead ${out.dead.length} · moved ${out.moved.length}`);
if (out.dead.length || out.moved.length) process.exitCode = 78;
