import { defineConfig, devices } from "@playwright/test";

/**
 * Responsive-audit harness.
 *
 * Three viewports, two colour schemes, one production build. The point is not
 * visual regression (no golden images are compared) — it is a set of hard
 * structural assertions about layout that a human eyeballing a page in one
 * window will miss: horizontal overflow, a wrapped header, a tap target below
 * the 34px floor, a drawer that traps focus.
 *
 * WebKit drives the phone project because it is the closest available engine to
 * iOS Safari, where the overwhelming majority of mobile traffic to a site like
 * this one lands. Chromium drives tablet and desktop.
 */

/**
 * Port 3000 by default. Override with `PORT=4747 npm run e2e` when something
 * else already owns 3000 — `reuseExistingServer` will otherwise silently attach
 * to that stranger's server and audit the wrong build.
 */
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Tap-target floor asserted by the suite; also exported for the spec. */
export const MIN_TAP_TARGET_PX = 34;

/** How long a full `npm run build` (data gate + 1100+ static pages) may take. */
const BUILD_AND_BOOT_TIMEOUT_MS = 900_000;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 90_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "off",
    // The suite writes its own evidence screenshots; this one is failure-only.
    screenshot: "only-on-failure",
  },

  projects: [
    {
      // iPhone 13 — 390x844, WebKit, touch, mobile meta-viewport semantics.
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        // The stock descriptor is 390x664 — it deducts Safari's chrome from the
        // 844px screen. The audit wants the full logical viewport, so pin it.
        viewport: { width: 390, height: 844 },
        // 3x shots of 1100-site pages are needlessly heavy as evidence.
        deviceScaleFactor: 1,
      },
    },
    {
      // iPad portrait — 768x1024.
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
        hasTouch: true,
      },
    },
    {
      // Laptop — 1440x900.
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],

  webServer: {
    // The audit must run against the real production render, not `next dev`:
    // dev-only overlays and unminified CSS change layout at the margins.
    command: "npm run build && npm run start",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: BUILD_AND_BOOT_TIMEOUT_MS,
    stdout: "ignore",
    stderr: "pipe",
  },
});
