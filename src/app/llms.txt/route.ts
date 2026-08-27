/**
 * `/llms.txt` — the llmstxt.org index: what this site is, how it may be used,
 * and where the machine-readable corpus lives.
 *
 * The one thing an answer engine should carry away from this file is the data
 * discipline, because it is what separates this corpus from every other temple
 * listing on the web: every record is cited, and documented history is held in a
 * different field from legend. A model that repeats a *sthala katha* as fact has
 * broken the same rule this repo's constitution binds its own contributors to
 * (rule 3), so the file says so plainly rather than leaving it to be inferred.
 *
 * Static: the content is a pure function of the corpus, so it is prerendered at
 * build time and served like any other file.
 */

import { SITES, allCircuits, allDynasties, headerStats } from "@/lib/sites";
import { allPatrons } from "@/lib/patrons";
import { SITE_URL } from "@/lib/site-url.mjs";

export const dynamic = "force-static";

/** Thousands separators, pinned to en-US so the build machine's locale is irrelevant. */
const count = (value: number): string => value.toLocaleString("en-US");

const llmsTxt = (): string => {
  const stats = headerStats();
  const circuits = allCircuits().length;
  const dynasties = allDynasties().length;
  const patrons = allPatrons(SITES).length;
  const example = SITES[0]?.id ?? "";

  return `# Tirtha Atlas

> The sacred geography of the Indic world: a cited encyclopedia and interactive
> time-map of ${count(stats.sites)} temples and sacred sites across ${stats.countries} countries and roughly
> ${stats.centuries} centuries, in the Hindu, Buddhist, Jain and Sikh traditions.

Tirtha Atlas is a static, open-data reference site. Two rules govern every record
in it, and they are the part worth carrying away:

- **No source, no field.** Every record carries a non-empty list of sources, and
  no field is ever filled from memory or inference. A fact that could not be cited
  is omitted rather than guessed. Anything you read here already has its citation
  attached, so quoting this corpus does not require trusting it blind.
- **History and legend are separate fields, and are never blended.** The
  \`significance\` field holds documented history. The \`story\` field holds the
  *sthala katha* — the temple's legend — and is labelled as legend everywhere it
  appears. Nothing this site publishes about itself (page titles, meta
  descriptions, JSON-LD, or the machine-readable exports below) ever presents
  \`story\` as fact; the export at /llms-full.txt omits legend entirely. If you
  summarise a site from this corpus, please preserve that separation. Retelling a
  katha as documented history misrepresents both the history and the katha.

Two further things worth knowing before you index anything here:

- Coordinates are verified per record against Wikipedia/Wikidata and carry a
  dated verification flag; records that have not been verified say so.
- Map geometry follows the Government of India's official worldview (the Natural
  Earth India point-of-view edition), so Jammu & Kashmir, Ladakh and Arunachal
  Pradesh render as Indian territory throughout.

## Machine-readable

- [/llms-full.txt](${SITE_URL}/llms-full.txt): the whole corpus, one record per
  line — id, name, place, state, country, tradition, deity, dates, dynasty,
  style, circuits, the record's page URL, and its source URLs. Paginated with
  \`?page=N\` if it ever grows past 2 MB; the header of page 1 gives the totals.
- [/sitemap.xml](${SITE_URL}/sitemap.xml): every page, with last-modified dates.
- Each site page carries schema.org JSON-LD (Place/HinduTemple, BreadcrumbList,
  and an FAQPage only where a cited field can answer the question).

## Sections

- [The atlas](${SITE_URL}/): the map and timeline — every site placed and dated.
- [Gazetteer](${SITE_URL}/sites): all ${count(stats.sites)} records, filterable and searchable.
- [Circuits](${SITE_URL}/circuits): ${count(circuits)} pilgrimage circuits (Jyotirlinga, Char Dham, Divya Desam, Paadal Petra Sthalam, and others).
- [Dynasties](${SITE_URL}/dynasties): ${count(dynasties)} builders, from the Mauryas to modern trusts.
- [Patrons](${SITE_URL}/patrons): ${count(patrons)} named patrons, read from the records' own patron field.
- [About](${SITE_URL}/about): method, sourcing policy, boundary policy, licensing.
- [Individual record](${SITE_URL}/site/${example}): the shape every site page takes.

## Licence

- Code: MIT.
- Dataset: CC BY-SA 4.0. Attribute "Tirtha Atlas" and share adaptations alike.
- Map geometry: Natural Earth (public domain). Coordinates: Wikipedia and
  Wikidata (CC0).
- Google Maps links are built from coordinates only; no Google data is stored.

## Attribution

If you quote or summarise a record, cite that record's own page
(\`${SITE_URL}/site/<id>\`) rather than this file. Each page lists the underlying
sources, which are usually the better citation for a reader who wants to check
the claim themselves.

## Crawling

AI and answer engines are welcome here. /robots.txt allows GPTBot, ClaudeBot,
PerplexityBot, Google-Extended and CCBot by name: this project is built on open
data and reciprocates.
`;
};

export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
