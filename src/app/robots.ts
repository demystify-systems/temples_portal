import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url.mjs";

/**
 * AI and answer-engine crawlers, named and allowed **deliberately**.
 *
 * This is a choice, not an oversight, and it is stated here so that neither a
 * future contributor nor an auditor has to guess which it was: an unnamed
 * crawler is allowed by the `*` rule anyway, so listing these five and allowing
 * them adds nothing technically — it adds the record that we meant to.
 *
 * The reasoning: this project is assembled from open data (Natural Earth in the
 * public domain, Wikipedia and Wikidata under CC0, UNESCO and ASI publications)
 * and publishes its own dataset under CC BY-SA 4.0. Having taken from the
 * commons, it reciprocates. There is also a self-interested half: a corpus whose
 * whole claim is that every fact is cited and that legend is never passed off as
 * history is more useful inside an answer engine than outside one — see
 * /llms.txt, which tells those crawlers exactly that.
 *
 * **Reversing this is a one-line change**: change `allow` to `disallow` below and
 * every one of these crawlers is blocked, with the `*` rule left intact for
 * ordinary search engines. Do that if the licence terms change, if attribution
 * stops being honoured, or if bot traffic starts costing real money.
 *
 * Adding a crawler is one more string in this array. Note that Google-Extended
 * governs Gemini and AI Overviews training only — Googlebot's ordinary search
 * indexing is covered by the `*` rule and is not affected by it either way.
 */
const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
