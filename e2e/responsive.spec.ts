import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * Responsive audit: every route, every viewport, both colour schemes.
 *
 * Nothing here compares golden images. Every assertion is a measurement with a
 * defensible floor, so a failure names the page, the viewport, the scheme and
 * the number of pixels by which the layout is wrong.
 */

/** Minimum comfortable tap target for the menu button, in CSS pixels. */
const MIN_TAP_TARGET_PX = 34;

/** A single-line stats row may not exceed one stat's height by more than this. */
const SINGLE_LINE_TOLERANCE = 1.8;

/** Sub-pixel slack allowed on the horizontal-overflow assertion. */
const OVERFLOW_SLACK_PX = 1;

const REPO_ROOT = path.resolve(__dirname, "..");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "e2e", "__screenshots__");

/**
 * The detail route is derived from the canonical dataset rather than hardcoded,
 * so the audit keeps testing a real page if the first record is ever renamed.
 */
function firstSiteSlug(): string {
  const raw = readFileSync(path.join(REPO_ROOT, "data", "sites.json"), "utf8");
  const sites = JSON.parse(raw) as Array<{ id?: string }>;
  const id = sites[0]?.id;
  if (!id) throw new Error("data/sites.json yielded no site id — cannot build the detail route");
  return id;
}

type Route = { name: string; url: string };

const SITE_SLUG = firstSiteSlug();

const ROUTES: Route[] = [
  { name: "home", url: "/" },
  { name: "sites", url: "/sites" },
  { name: "circuits", url: "/circuits" },
  { name: "dynasties", url: "/dynasties" },
  { name: "about", url: "/about" },
  { name: "site-detail", url: `/site/${SITE_SLUG}` },
];

const ROUTE = Object.fromEntries(ROUTES.map((r) => [r.name, r])) as Record<string, Route>;

type Scheme = "light" | "dark";
const SCHEMES: Scheme[] = ["light", "dark"];

/* ------------------------------------------------------------------ helpers */

/** Navigate and wait until fonts and a first paint have settled — both move layout. */
async function visit(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await page.locator(".sitehead").waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

type OverflowReading = {
  scrollWidth: number;
  clientWidth: number;
  innerWidth: number;
  bodyScrollWidth: number;
};

function readOverflow(page: Page): Promise<OverflowReading> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
}

type Offender = { selector: string; left: number; right: number; width: number };

/**
 * Only called once an overflow assertion is already known to fail: walking every
 * element is far too expensive to do on a 1100-row gazetteer speculatively.
 */
function findOverflowingElements(page: Page, limit = 6): Promise<Offender[]> {
  return page.evaluate((max) => {
    const edge = document.documentElement.clientWidth;
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string" && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const found: Offender[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right <= edge + 1) continue;
      if (getComputedStyle(el).position === "fixed") continue;
      found.push({
        selector: describe(el),
        left: Math.round(box.left),
        right: Math.round(box.right),
        width: Math.round(box.width),
      });
    }
    return found.sort((a, b) => b.right - a.right).slice(0, max);
  }, limit);
}

function screenshotPath(testInfo: TestInfo, scheme: Scheme, routeName: string): string {
  return path.join(SCREENSHOT_DIR, `${testInfo.project.name}-${scheme}-${routeName}.png`);
}

async function box(locator: Locator, what: string) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error(`${what} has no bounding box — it is not rendered`);
  return rect;
}

/** The drawer is always in the DOM; "closed" means translated fully off the left edge. */
async function expectDrawerOffscreen(drawer: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const rect = await drawer.boundingBox();
      return rect ? Math.round(rect.x + rect.width) : null;
    }, { message: "drawer should be translated fully off the left edge when closed" })
    .toBeLessThanOrEqual(0);
}

async function expectDrawerOnscreen(drawer: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const rect = await drawer.boundingBox();
      return rect ? Math.round(rect.x) : null;
    }, { message: "drawer should slide fully into view when open" })
    .toBeGreaterThanOrEqual(0);
}

/* -------------------------------------------------------------------- suite */

for (const scheme of SCHEMES) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    /* --- 1. the page never scrolls horizontally, on any route ------------- */

    for (const route of ROUTES) {
      test(`${route.name} — no horizontal page scroll`, async ({ page }, testInfo) => {
        await visit(page, route.url);

        // Evidence first: a failing assertion should still leave a screenshot.
        await page.screenshot({ path: screenshotPath(testInfo, scheme, route.name) });

        const reading = await readOverflow(page);
        const overflow = reading.scrollWidth - reading.clientWidth;

        if (overflow > OVERFLOW_SLACK_PX) {
          const offenders = await findOverflowingElements(page);
          const detail = offenders
            .map((o) => `    ${o.selector} — left ${o.left}px, right ${o.right}px, width ${o.width}px`)
            .join("\n");
          throw new Error(
            `Horizontal overflow on ${route.url} at ${testInfo.project.name}/${scheme}:\n` +
              `  documentElement.scrollWidth=${reading.scrollWidth} clientWidth=${reading.clientWidth} ` +
              `(over by ${overflow}px), window.innerWidth=${reading.innerWidth}, ` +
              `body.scrollWidth=${reading.bodyScrollWidth}\n` +
              `  widest elements past the right edge:\n${detail || "    (none found — check a fixed/absolute child)"}`,
          );
        }

        expect(reading.scrollWidth).toBeLessThanOrEqual(reading.clientWidth + OVERFLOW_SLACK_PX);
      });
    }

    /* --- 2. the header stats row stays on one line ------------------------ */

    for (const route of [ROUTE.home, ROUTE["site-detail"]]) {
      test(`${route.name} — header stats row stays on one line`, async ({ page }, testInfo) => {
        await visit(page, route.url);

        const stats = page.locator(".hstats");
        await expect(stats).toBeVisible();

        const rowRect = await box(stats, ".hstats");
        const statRect = await box(page.locator(".hstats .st").first(), "first .hstats .st");
        const visibleStats = await page.locator(".hstats .st").evaluateAll(
          (nodes) => nodes.filter((n) => getComputedStyle(n).display !== "none").length,
        );

        expect(
          rowRect.height,
          `.hstats wrapped at ${testInfo.project.name}/${scheme} on ${route.url}: ` +
            `row height ${rowRect.height.toFixed(1)}px vs one .st at ${statRect.height.toFixed(1)}px ` +
            `(${visibleStats} stats visible)`,
        ).toBeLessThan(statRect.height * SINGLE_LINE_TOLERANCE);

        // A row that "fits" only by spilling out of the header is not fitting.
        const headRect = await box(page.locator(".sitehead"), ".sitehead");
        expect(
          Math.round(rowRect.x + rowRect.width),
          `.hstats spills past the header's right edge at ${testInfo.project.name}/${scheme}`,
        ).toBeLessThanOrEqual(Math.round(headRect.x + headRect.width) + 1);
      });
    }

    /* --- 3. the hamburger is a real tap target at every breakpoint -------- */

    test(`menu button is >= ${MIN_TAP_TARGET_PX}x${MIN_TAP_TARGET_PX} and visible`, async ({ page }, testInfo) => {
      for (const route of [ROUTE.home, ROUTE.about]) {
        await visit(page, route.url);

        const hamb = page.locator(".hamb");
        await expect(hamb, `.hamb missing on ${route.url}`).toBeVisible();

        const rect = await box(hamb, ".hamb");
        const where = `${testInfo.project.name}/${scheme} on ${route.url}`;
        expect(rect.width, `.hamb too narrow at ${where}: ${rect.width.toFixed(1)}px`).toBeGreaterThanOrEqual(
          MIN_TAP_TARGET_PX,
        );
        expect(rect.height, `.hamb too short at ${where}: ${rect.height.toFixed(1)}px`).toBeGreaterThanOrEqual(
          MIN_TAP_TARGET_PX,
        );
      }
    });

    /* --- 4. the drawer opens, announces itself, and returns focus --------- */

    for (const route of [ROUTE.home, ROUTE.circuits]) {
      test(`${route.name} — drawer opens, Escape closes it and restores focus`, async ({ page }) => {
        await visit(page, route.url);

        const hamb = page.locator(".hamb");
        const drawer = page.locator(".navdrawer");

        await expect(hamb).toHaveAttribute("aria-expanded", "false");
        await expectDrawerOffscreen(drawer);

        await hamb.click();

        await expect(hamb).toHaveAttribute("aria-expanded", "true");
        await expect(drawer).toHaveClass(/\bopen\b/);
        await expect(drawer).toBeVisible();
        await expectDrawerOnscreen(drawer);
        // Focus moves into the drawer, so Escape and Tab are handled there.
        await expect(page.locator(".navclose")).toBeFocused();

        await page.keyboard.press("Escape");

        await expect(hamb).toHaveAttribute("aria-expanded", "false");
        await expect(drawer).not.toHaveClass(/\bopen\b/);
        await expectDrawerOffscreen(drawer);
        await expect(hamb, "focus must return to the menu button after Escape").toBeFocused();
      });
    }
  });
}
