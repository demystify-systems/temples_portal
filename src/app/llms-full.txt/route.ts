/**
 * `/llms-full.txt` — the whole corpus as one line-oriented text file.
 *
 * The point of this file is that a model does not have to crawl 1,000+ HTML
 * pages (or guess) to answer "which Chola temples are on the Paadal Petra
 * Sthalam circuit". One fetch gives it every record's identifying fields, the
 * canonical page URL to cite, and the source URLs behind the record.
 *
 * What is deliberately NOT here: `story`. Legend (*sthala katha*) is real and
 * worth reading, but a bare line in a machine digest strips the label that keeps
 * it from being read as history — and constitution rule 3 forbids that blend.
 * Legend stays on the page, next to the words "the legend". `significance` is
 * also omitted: at ~300 characters a record it would multiply this file's size,
 * and the page URL in each line leads to it, cited.
 *
 * The corpus is still read from the repo JSON at module scope (rule 6,
 * static-first) — the handler is dynamic only because `?page=` is a query
 * parameter, and the response is edge-cacheable.
 */

import { SITES, type Site } from "@/lib/sites";
import { SITE_URL } from "@/lib/site-url.mjs";

/** `?page=` is read from the request, so this cannot be prerendered. */
export const dynamic = "force-dynamic";

/** The cap the task sets: no single response above roughly 2 MB. */
const MAX_PAGE_BYTES = 2_000_000;

/** Room for the header block, so the whole response stays under the cap. */
const HEADER_ALLOWANCE_BYTES = 4_000;

const SEPARATOR = " | ";
const CIRCUIT_SEPARATOR = " ~ ";
const SOURCE_SEPARATOR = " ";

const COLUMNS =
  "id | name | place | state | country | tradition | deity | built | dynasty | style | circuits | url | sources";

/**
 * Make one cell safe to sit in a pipe-delimited line.
 *
 * A literal "|" inside a value (none today, but the corpus grows) would silently
 * shift every later column, which is worse than losing the character.
 */
const cell = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();

const digestLine = (site: Site): string =>
  [
    site.id,
    site.name,
    site.place,
    site.state,
    site.country,
    site.tradition,
    site.deity,
    site.builtDisplay,
    site.dynasty,
    site.style,
    (site.circuits ?? []).join(CIRCUIT_SEPARATOR),
    `${SITE_URL}/site/${site.id}`,
    site.sources.map((source) => source.u).join(SOURCE_SEPARATOR),
  ]
    .map(cell)
    .join(SEPARATOR);

const encoder = new TextEncoder();

let cachedPages: readonly (readonly string[])[] | null = null;

/** Split the corpus into byte-budgeted pages once, then reuse them. */
const pages = (): readonly (readonly string[])[] => {
  if (cachedPages) return cachedPages;

  const budget = MAX_PAGE_BYTES - HEADER_ALLOWANCE_BYTES;
  const built: string[][] = [[]];
  let bytes = 0;

  for (const site of SITES) {
    const line = digestLine(site);
    const size = encoder.encode(line).length + 1; // +1 for the newline
    if (bytes > 0 && bytes + size > budget) {
      built.push([]);
      bytes = 0;
    }
    built[built.length - 1]!.push(line);
    bytes += size;
  }

  cachedPages = built;
  return cachedPages;
};

const header = (page: number, total: number, from: number, to: number): string =>
  [
    "# Tirtha Atlas — machine-readable digest of the corpus",
    `# ${SITES.length} records · page ${page} of ${total} · records ${from}–${to} on this page`,
    `# Index and licence terms: ${SITE_URL}/llms.txt`,
    "#",
    "# Every field below comes from a cited source; the citations are the last",
    "# column, and the page named in the `url` column lists them in full.",
    "# Legend (sthala katha) is deliberately absent from this file: it lives in the",
    "# `story` field on each record's page, always labelled as legend, never as",
    "# history. Please do not restate it as fact.",
    "#",
    "# Licence: dataset CC BY-SA 4.0 (attribute \"Tirtha Atlas\", share alike) ·",
    "# code MIT · map geometry Natural Earth (public domain) · coordinates CC0.",
    "#",
    `# Column separator: "${SEPARATOR}". Circuits inside a cell: "${CIRCUIT_SEPARATOR}". Sources: a space.`,
    "# An empty cell means the record does not carry that field. It never means",
    "# the value is unknown but inferable — an uncited fact is omitted by policy.",
    `# Columns: ${COLUMNS}`,
    total > 1 && page < total ? `# Next page: ${SITE_URL}/llms-full.txt?page=${page + 1}` : "# Last page.",
    "",
  ].join("\n");

const plain = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });

export function GET(request: Request): Response {
  const requested = new URL(request.url).searchParams.get("page");
  if (requested !== null && !/^[1-9]\d*$/.test(requested)) {
    return plain(`# "page" must be a positive integer, e.g. ${SITE_URL}/llms-full.txt?page=1\n`, 400);
  }

  const all = pages();
  const page = requested === null ? 1 : Number(requested);
  if (page > all.length) {
    return plain(`# No such page. This corpus has ${all.length} page(s); ask for 1–${all.length}.\n`, 404);
  }

  const lines = all[page - 1]!;
  const from = all.slice(0, page - 1).reduce((sum, p) => sum + p.length, 0) + 1;
  return plain(`${header(page, all.length, from, from + lines.length - 1)}${lines.join("\n")}\n`);
}
