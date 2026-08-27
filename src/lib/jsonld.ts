/**
 * JSON-LD builders — pure functions of a single site record.
 *
 * Two constitutional rules shape everything here:
 *
 *  - Rule 2 (no source → no field → no publish). A builder may only restate what
 *    the record actually carries. Every optional field is omitted when absent
 *    rather than filled with a plausible sentence, and `faqJsonLd` returns null
 *    when the record has nothing sourced to answer with. Structured data is
 *    published data: an invented answer here is an invented answer in Google's
 *    index.
 *  - Rule 3 (history ≠ katha). `significance` is documented history and becomes
 *    the Place `description`; `story` is legend and only ever appears in an
 *    explicitly legend-labelled FAQ answer. They are never concatenated.
 *
 * Like site-utils.ts this module keeps its distance from the corpus: the only
 * reference to `sites.ts` is a type-only import, which is erased at runtime, so
 * the test runner never loads data/sites.json.
 */

import type { Site } from "./sites.ts";
import { gmapsUrl } from "./site-utils.ts";
import { SITE_URL } from "./site-url.mjs";

/** A JSON-LD node: a plain object, ready for JSON.stringify. */
export type JsonLdNode = Record<string, unknown>;

/** The rendered dimensions of the per-site OG image (see opengraph-image.tsx). */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/**
 * schema.org has no Jain or Sikh subtype of PlaceOfWorship, so those fall back
 * to the parent type rather than being mislabelled as a temple of another faith.
 */
const PLACE_TYPE: Readonly<Record<Site["tradition"], string>> = {
  Hindu: "HinduTemple",
  Buddhist: "BuddhistTemple",
  Jain: "PlaceOfWorship",
  Sikh: "PlaceOfWorship",
};

/** A trimmed string, or undefined when the value is absent or blank. */
const text = (value: string | undefined | null): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
};

const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

/**
 * A new object without the keys whose value is absent, blank or an empty array.
 * Never mutates its argument — callers build a full shape and let this drop the
 * parts the record could not support.
 */
const compact = (node: JsonLdNode): JsonLdNode =>
  Object.fromEntries(Object.entries(node).filter(([, value]) => !isEmptyValue(value)));

/** Canonical URL of a site's page on this portal. */
export const siteUrl = (site: Pick<Site, "id">): string => `${SITE_URL}/site/${site.id}`;

/** Canonical URL of a site's generated OG image (Next metadata route). */
export const siteImageUrl = (site: Pick<Site, "id">): string => `${siteUrl(site)}/opengraph-image`;

/** ImageObject for the generated per-site OG card. */
export const imageJsonLd = (site: Site): JsonLdNode => {
  const url = siteImageUrl(site);
  return compact({
    "@type": "ImageObject",
    url,
    contentUrl: url,
    width: OG_WIDTH,
    height: OG_HEIGHT,
    caption: [text(site.name), text(site.place), text(site.country)].filter(Boolean).join(" — "),
  });
};

/**
 * Place / HinduTemple / BuddhistTemple node for a site.
 *
 * `description` is `significance` verbatim — documented history only (rule 3).
 * `sameAs` carries the official site and Wikipedia when the record cites them;
 * `telephone` appears only when the record has a phone, which per rule 4 means
 * it was taken from the official site or call-verified.
 */
export const placeJsonLd = (site: Site): JsonLdNode => {
  const url = siteUrl(site);
  return compact({
    "@context": "https://schema.org",
    "@type": PLACE_TYPE[site.tradition] ?? "PlaceOfWorship",
    "@id": url,
    name: text(site.name),
    alternateName: text(site.alt),
    description: text(site.significance),
    geo: { "@type": "GeoCoordinates", latitude: site.lat, longitude: site.lng },
    address: compact({
      "@type": "PostalAddress",
      addressLocality: text(site.place),
      addressRegion: text(site.state),
      addressCountry: text(site.country),
    }),
    hasMap: gmapsUrl(site),
    image: imageJsonLd(site),
    telephone: text(site.phone),
    url,
    sameAs: [text(site.website), text(site.wiki)].filter(Boolean),
  });
};

/**
 * Home → Gazetteer → Country → State → Site.
 *
 * The country and state rungs carry a name but no `item`: the portal has no
 * per-country or per-state route, and pointing structured data at a URL that
 * 404s is worse than leaving the rung unlinked. Positions are assigned after
 * the optional state rung is dropped, so they are always contiguous from 1.
 */
export const breadcrumbJsonLd = (site: Site): JsonLdNode => {
  const rungs: readonly { name: string | undefined; item?: string }[] = [
    { name: "Home", item: `${SITE_URL}/` },
    { name: "Gazetteer", item: `${SITE_URL}/sites` },
    { name: text(site.country) },
    { name: text(site.state) },
    { name: text(site.name), item: siteUrl(site) },
  ];

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: rungs
      .filter((rung) => text(rung.name) !== undefined)
      .map((rung, index) => compact({ "@type": "ListItem", position: index + 1, name: rung.name, item: rung.item })),
  };
};

/**
 * FAQPage built strictly from fields the record actually carries.
 *
 * There are exactly two sourced things a site record can answer: how to reach it
 * (`access`) and what legend is told about it (`story`). A record missing both
 * gets no FAQ at all — null, not a page of generated prose. Answers are the
 * stored text verbatim; nothing is paraphrased, completed or inferred.
 */
export const faqJsonLd = (site: Site): JsonLdNode | null => {
  const access = text(site.access);
  const story = text(site.story);
  const name = text(site.name) ?? "this site";

  const pairs = [
    access ? { question: `How do I reach ${name}?`, answer: access } : null,
    // Labelled as legend, never as history (rule 3).
    story ? { question: `What is the sthala katha — the legend — of ${name}?`, answer: story } : null,
  ].filter((pair): pair is { question: string; answer: string } => pair !== null);

  if (pairs.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${siteUrl(site)}#faq`,
    mainEntity: pairs.map((pair) => ({
      "@type": "Question",
      name: pair.question,
      acceptedAnswer: { "@type": "Answer", text: pair.answer },
    })),
  };
};

/**
 * Serialise nodes for a single <script type="application/ld+json"> tag.
 *
 * Nulls are dropped, and every "<" is escaped so a stray "</script>" in record
 * text can never close the tag early.
 */
export const serializeJsonLd = (nodes: readonly (JsonLdNode | null)[]): string =>
  JSON.stringify(nodes.filter((node): node is JsonLdNode => node !== null)).replace(/</g, "\\u003c");
