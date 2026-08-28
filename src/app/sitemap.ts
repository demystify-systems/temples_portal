import type { MetadataRoute } from "next";
import { SITES, allCircuits, allDeities, allDynasties, slugify, type Site } from "@/lib/sites";
import { allPatrons } from "@/lib/patrons";
import { SITE_URL as base } from "@/lib/site-url.mjs";

/**
 * `lastModified` is read from the data, never from the clock.
 *
 * Stamping every URL with the build time would mark 1,000+ pages as changed on
 * every deploy, including deploys that only touched CSS. Google treats a lastmod
 * that always moves as noise and starts ignoring the field — which costs us the
 * one signal that matters when a record actually is re-verified. Each record
 * carries a dated verification flag ("wikipedia-2026-08-27"); that date is the
 * closest thing the corpus has to "when this page's content last changed", and
 * it stays put between builds.
 */
const verifiedDate = (site: Site): Date | undefined => {
  const match = /(\d{4}-\d{2}-\d{2})$/.exec(site.verified ?? "");
  return match ? new Date(`${match[1]}T00:00:00Z`) : undefined;
};

/** Only reached if no record anywhere carries a dated flag — see verifiedDate. */
const BUILD_DATE = new Date();

/** The newest verification date among these records. */
const latest = (sites: readonly Site[]): Date =>
  sites.reduce<Date | undefined>((newest, site) => {
    const date = verifiedDate(site);
    return date && (!newest || date > newest) ? date : newest;
  }, undefined) ?? BUILD_DATE;

/** When the corpus as a whole last moved — the lastmod for every derived page. */
const CORPUS_LAST_MODIFIED = latest(SITES);

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    // The atlas itself, then the record pages: they hold the cited content, so
    // they outrank the indexes that merely list them, which outrank /about.
    { url: base, lastModified: CORPUS_LAST_MODIFIED, changeFrequency: "weekly", priority: 1 },
    ...SITES.map((s) => ({
      url: `${base}/site/${s.id}`,
      lastModified: verifiedDate(s) ?? CORPUS_LAST_MODIFIED,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),

    // Indexes. The gazetteer changes with every record added; the rest only when
    // a new circuit, dynasty or patron first appears.
    { url: `${base}/sites`, lastModified: CORPUS_LAST_MODIFIED, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/circuits`, lastModified: CORPUS_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/dynasties`, lastModified: CORPUS_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/deities`, lastModified: CORPUS_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/patrons`, lastModified: CORPUS_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.7 },

    // Grouping pages: each moves when one of its member records is re-verified.
    ...allCircuits().map(([name, sites]) => ({
      url: `${base}/circuit/${slugify(name)}`,
      lastModified: latest(sites),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...allDynasties().map(([name, sites]) => ({
      url: `${base}/dynasty/${slugify(name)}`,
      lastModified: latest(sites),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    // One per canonical deity tag, derived from the corpus exactly as
    // generateStaticParams does — so the sitemap and the routes that exist can
    // never disagree, however the vocabulary grows. A corpus with no tags
    // contributes no entries here at all.
    ...allDeities().map(([name, sites]) => ({
      url: `${base}/deity/${slugify(name)}`,
      lastModified: latest(sites),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...allPatrons(SITES).map((p) => ({
      url: `${base}/patron/${p.slug}`,
      lastModified: latest(p.sites),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),

    // Method and licensing: true, useful, and the last thing anyone searches for.
    { url: `${base}/about`, lastModified: CORPUS_LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
  ];
}
