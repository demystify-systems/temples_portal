// Rasterise the app icon for the PWA manifest.
//
//   node scripts/build-icons.mjs
//
// The atlas has ONE icon, src/app/icon.svg, and it is the source of truth. A
// manifest needs PNGs at fixed sizes as well, and hand-exporting those is how
// an icon set drifts: the favicon gets updated, the install icon does not, and
// the installed app keeps last year's mark for a year.
//
// So they are generated, from the SVG, by the same build that generates
// everything else. Playwright is already a devDependency for the e2e suite, so
// this costs no new dependency — it renders the SVG in the browser that will
// display it, which is also the only renderer whose output is guaranteed to
// match what a user sees.
//
// The MASKABLE variant is not the same image scaled. Android crops a maskable
// icon to whatever shape the launcher uses — circle, squircle, teardrop — and
// anything outside the middle 80% can be cut. The mark is therefore inset into
// a full-bleed background so a circular crop takes only the background.

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVG = path.join(ROOT, "src", "app", "icon.svg");
const OUT = path.join(ROOT, "public");

/** `safe` is the fraction of the canvas the mark occupies. 1 = full bleed. */
const TARGETS = [
  { file: "icon-192.png", size: 192, safe: 1 },
  { file: "icon-512.png", size: 512, safe: 1 },
  // 0.62 keeps the whole mark inside the 80% circle Android may crop to, with
  // room to spare — a maskable icon that loses its spire is worse than no icon.
  { file: "icon-maskable.png", size: 512, safe: 0.62 },
];

/** The SVG's own background, so the inset area is not transparent. */
const BACKGROUND = "#131722";

const main = async () => {
  if (!existsSync(SVG)) {
    console.error(`build-icons: ${SVG} not found`);
    process.exit(1);
  }
  const svg = readFileSync(SVG, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const { file, size, safe } of TARGETS) {
    const inset = Math.round((size * (1 - safe)) / 2);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${BACKGROUND};` +
      `display:flex;align-items:center;justify-content:center">` +
      `<div style="width:${size - inset * 2}px;height:${size - inset * 2}px">${svg}</div>` +
      `</body></html>`,
      { waitUntil: "load" },
    );
    // The SVG carries its own rounded corners; a maskable icon must be square
    // to the edge or the launcher's crop leaves transparent notches.
    if (safe < 1) await page.addStyleTag({ content: "svg rect:first-of-type{rx:0}" });
    const buffer = await page.screenshot({ omitBackground: false });
    writeFileSync(path.join(OUT, file), buffer);
    console.log(`build-icons: ${file} (${size}x${size}${safe < 1 ? ", maskable" : ""})`);
  }

  await browser.close();
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error("build-icons:", error); process.exit(1); });
}
