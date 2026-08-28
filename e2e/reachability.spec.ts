import { expect, test, type Page } from "@playwright/test";

/**
 * Can every control actually be tapped?
 *
 * This suite exists because three separate bugs in one afternoon were the same
 * bug, and none of them was visible:
 *
 *   - the era key sat under the bottom sheet (z-index 3 vs 8);
 *   - the assistant launcher sat on the timeline's era buttons;
 *   - the coach mark's "Got it" sat under the assistant launcher.
 *
 * In every case the control rendered perfectly: right size, right place, right
 * accessible name, correct `aria-*`. It simply never received the tap. And in
 * every case an automated `.click()` reported success, because a programmatic
 * click dispatches straight at the element and passes through whatever is
 * covering it. The test was green and the finger got nothing.
 *
 * So the assertion here is not "does clicking work" — it is `elementFromPoint`:
 * given the middle of this control, is this control what the browser would
 * actually deliver the tap to? That is the question a user asks with their
 * thumb, and the only one that catches an overlap.
 *
 * Run in the FIRST-RUN state deliberately, with storage cleared, because that is
 * when the most furniture is on screen at once — coach mark, intro sheet, era
 * key, launcher, timeline — and therefore when things collide. A returning
 * visitor has dismissed half of it and would never see the bug.
 */

/** Long enough for the timeline coach mark, which appears on a delay. */
const COACH_DELAY_MS = 4_500;

type Unreachable = {
  readonly control: string;
  readonly label: string;
  readonly blockedBy: string;
  readonly at: string;
};

/**
 * Every control the browser would NOT deliver a tap to.
 *
 * Skips what is legitimately unreachable rather than broken: zero-sized nodes,
 * anything scrolled off-screen, `hidden` subtrees, `pointer-events:none`, and
 * the nav drawer while it is closed — its items are translated off-canvas by
 * design, not covered.
 */
async function unreachableControls(page: Page): Promise<Unreachable[]> {
  return page.evaluate(() => {
    const drawerOpen = document.querySelector(".navdrawer")?.classList.contains("open") ?? false;
    const out: Unreachable[] = [];

    for (const el of document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, [role="slider"]',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.right < 0 || r.left > window.innerWidth) continue;
      if (el.closest("[hidden]")) continue;
      if (!drawerOpen && el.closest(".navdrawer")) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") continue;

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) continue;

      const top = document.elementFromPoint(cx, cy);
      // `top.contains(el)` matters: a tap landing on a WRAPPER that contains the
      // control still reaches it by bubbling, and is not a defect.
      const reachable = top !== null && (el === top || el.contains(top) || top.contains(el));
      if (reachable) continue;

      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
      const describe = (n: Element | null) =>
        n ? `${n.tagName.toLowerCase()}.${String((n as HTMLElement).className ?? "").split(" ")[0]}` : "nothing";
      out.push({
        control: describe(el),
        label: name,
        blockedBy: describe(top),
        at: `${Math.round(cx)},${Math.round(cy)}`,
      });
    }
    return out;
  });
}

const report = (found: Unreachable[]) =>
  found.map((f) => `  ${f.control} "${f.label}" at ${f.at} is covered by ${f.blockedBy}`).join("\n");

test.describe("every control can actually be tapped", () => {
  test("first run, with the coach mark and the intro sheet both showing", async ({ page }) => {
    await page.goto("/");
    // The first-run state is the crowded one, and the only one where the coach
    // mark exists at all.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(COACH_DELAY_MS);

    const found = await unreachableControls(page);
    expect(found, `controls the browser would not deliver a tap to:\n${report(found)}`).toEqual([]);
  });

  test("with a temple selected, so the detail sheet is open", async ({ page }) => {
    // Selected by URL, not by clicking a mark. At 390x844 the first mark in
    // document order sits outside the viewport — the map is pannable and only a
    // fraction of 3,031 marks is on screen — so `.pt` first is "not visible" and
    // the click never lands. The hash is how the app restores a selection
    // anyway, so this exercises the same code path without depending on where
    // one particular temple happens to fall on this screen.
    await page.goto("/#site=brihadisvara-thanjavur");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(1_500);
    await expect(page.locator(".side.sheet.open")).toBeVisible();

    const found = await unreachableControls(page);
    expect(found, `controls covered while the detail sheet is open:\n${report(found)}`).toEqual([]);
  });

  test("with the navigation drawer open, its own items are reachable", async ({ page }) => {
    // Scoped to the drawer on purpose. An open drawer is MODAL: the scrim
    // exists precisely so the controls behind it cannot be tapped, and the
    // first version of this test asserted the opposite — it flagged fourteen
    // background controls as broken when every one of them was correctly
    // blocked. What matters here is that the drawer's own items work.
    await page.goto("/");
    await page.locator(".hamb").click();
    await page.waitForTimeout(700);
    await expect(page.locator(".navdrawer.open")).toBeVisible();

    const found = (await unreachableControls(page)).filter((f) =>
      f.control.startsWith("a.navitem") || f.control.startsWith("button.navitem") || f.control.startsWith("button.navclose"),
    );
    expect(found, `drawer items the browser would not deliver a tap to:\n${report(found)}`).toEqual([]);
  });

  test("the scrim really does block what is behind an open drawer", async ({ page }) => {
    // The inverse assertion, and the reason the test above is scoped: a modal
    // that does NOT block the page behind it is its own bug, and this is what
    // proves the blocking is deliberate rather than accidental.
    await page.goto("/");
    await page.locator(".hamb").click();
    await page.waitForTimeout(700);

    const blocked = (await unreachableControls(page)).filter((f) => !f.control.includes("navitem"));
    expect(blocked.length, "an open drawer should cover the page behind it").toBeGreaterThan(0);
  });

  test("the era key opens and closes by a real tap, not a dispatched one", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(COACH_DELAY_MS);

    const legend = page.locator(".maplegend");
    const toggle = page.locator(".legendtoggle");
    const width = async () => (await legend.boundingBox())?.width ?? 0;

    const collapsed = await width();
    // A real click: Playwright hit-tests and will fail if something is on top,
    // which a page.evaluate(el => el.click()) would silently sail through.
    await toggle.click();
    await page.waitForTimeout(350);
    const expanded = await width();
    expect(expanded, "tapping the key should widen it").toBeGreaterThan(collapsed);

    await toggle.click();
    await page.waitForTimeout(350);
    expect(await width(), "tapping again should collapse it").toBeLessThan(expanded);
  });
});
