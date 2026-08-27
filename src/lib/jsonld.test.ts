import test from "node:test";
import assert from "node:assert/strict";
import type { Site } from "./sites.ts";
import { SITE_URL } from "./site-url.mjs";
import {
  placeJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
  imageJsonLd,
  serializeJsonLd,
  siteUrl,
  type JsonLdNode,
} from "./jsonld.ts";

/**
 * A minimal record carrying only the fields data/sites.json guarantees. Optional
 * fields are added per-test, so "absent" in a test means genuinely absent —
 * which is what the no-source-no-field rule is about.
 */
const makeSite = (overrides: Partial<Site> = {}): Site => ({
  id: "brihadisvara-thanjavur",
  name: "Brihadisvara Temple",
  country: "India",
  state: "Tamil Nadu",
  place: "Thanjavur",
  lat: 10.7828,
  lng: 79.1318,
  tradition: "Hindu",
  deity: "Shiva",
  built: [1003, 1010],
  builtDisplay: "1003–1010 CE",
  dynasty: "Chola",
  style: "Dravida",
  significance: "Imperial Chola temple completed under Rajaraja I; a UNESCO World Heritage Site.",
  sources: [{ l: "UNESCO", u: "https://whc.unesco.org/en/list/250/" }],
  ...overrides,
});

/** Every leaf value in a nested JSON-LD node, with the path that reached it. */
const leaves = (value: unknown, path = "$"): readonly { path: string; value: unknown }[] => {
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${path}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
  }
  return [{ path, value }];
};

const positions = (node: JsonLdNode): number[] =>
  (node.itemListElement as { position: number }[]).map((item) => item.position);

const names = (node: JsonLdNode): string[] =>
  (node.itemListElement as { name: string }[]).map((item) => item.name);

// ---------------------------------------------------------------- placeJsonLd

test("placeJsonLd includes geo coordinates from the record", () => {
  const node = placeJsonLd(makeSite());
  assert.deepEqual(node.geo, { "@type": "GeoCoordinates", latitude: 10.7828, longitude: 79.1318 });
});

test("placeJsonLd keeps coordinates numeric, including a zero", () => {
  const node = placeJsonLd(makeSite({ lat: 0, lng: 0 }));
  const geo = node.geo as { latitude: unknown; longitude: unknown };
  assert.equal(typeof geo.latitude, "number");
  assert.equal(geo.latitude, 0, "0°N is a real coordinate, not an absent one");
  assert.equal(geo.longitude, 0);
});

test("placeJsonLd picks the schema.org type matching the tradition", () => {
  assert.equal(placeJsonLd(makeSite({ tradition: "Hindu" }))["@type"], "HinduTemple");
  assert.equal(placeJsonLd(makeSite({ tradition: "Buddhist" }))["@type"], "BuddhistTemple");
  // schema.org has no Jain or Sikh subtype; the parent type is used rather than
  // a temple type belonging to another faith.
  assert.equal(placeJsonLd(makeSite({ tradition: "Jain" }))["@type"], "PlaceOfWorship");
  assert.equal(placeJsonLd(makeSite({ tradition: "Sikh" }))["@type"], "PlaceOfWorship");
});

test("placeJsonLd describes the site with documented history, never with legend", () => {
  const site = makeSite({ story: "Shiva is said to have appeared here as a column of light." });
  const node = placeJsonLd(site);
  assert.equal(node.description, site.significance);
  assert.ok(!String(node.description).includes("column of light"), "katha must not leak into history");
});

test("placeJsonLd omits fields the record does not carry", () => {
  const node = placeJsonLd(makeSite());
  for (const key of ["alternateName", "telephone", "sameAs"]) {
    assert.ok(!(key in node), `${key} must be absent, not empty`);
  }
});

test("placeJsonLd emits sameAs only for links the record actually cites", () => {
  const withWiki = placeJsonLd(makeSite({ wiki: "https://en.wikipedia.org/wiki/X" }));
  assert.deepEqual(withWiki.sameAs, ["https://en.wikipedia.org/wiki/X"]);

  const withBoth = placeJsonLd(makeSite({ website: "https://example.org", wiki: "https://en.wikipedia.org/wiki/X" }));
  assert.deepEqual(withBoth.sameAs, ["https://example.org", "https://en.wikipedia.org/wiki/X"]);
});

test("placeJsonLd drops an address region the record leaves blank", () => {
  const address = placeJsonLd(makeSite({ state: "   " })).address as Record<string, unknown>;
  assert.ok(!("addressRegion" in address));
  assert.equal(address.addressLocality, "Thanjavur");
});

test("placeJsonLd anchors the node at the canonical page URL", () => {
  const site = makeSite();
  assert.equal(placeJsonLd(site)["@id"], `${SITE_URL}/site/${site.id}`);
  assert.equal(placeJsonLd(site).url, siteUrl(site));
});

// ---------------------------------------------------------------- imageJsonLd

test("imageJsonLd points at the generated OG card at its rendered size", () => {
  const site = makeSite();
  const node = imageJsonLd(site);
  assert.equal(node["@type"], "ImageObject");
  assert.equal(node.url, `${SITE_URL}/site/${site.id}/opengraph-image`);
  assert.equal(node.width, 1200);
  assert.equal(node.height, 630);
});

// ----------------------------------------------------------- breadcrumbJsonLd

test("breadcrumbJsonLd orders Home > Gazetteer > Country > State > Site", () => {
  const node = breadcrumbJsonLd(makeSite());
  assert.deepEqual(names(node), ["Home", "Gazetteer", "India", "Tamil Nadu", "Brihadisvara Temple"]);
  assert.deepEqual(positions(node), [1, 2, 3, 4, 5]);
});

test("breadcrumbJsonLd renumbers contiguously when the record has no state", () => {
  const node = breadcrumbJsonLd(makeSite({ state: undefined }));
  assert.deepEqual(names(node), ["Home", "Gazetteer", "India", "Brihadisvara Temple"]);
  assert.deepEqual(positions(node), [1, 2, 3, 4], "positions must not skip the dropped rung");
});

test("breadcrumbJsonLd positions always ascend from 1 by 1", () => {
  for (const site of [makeSite(), makeSite({ state: undefined }), makeSite({ state: "" })]) {
    const list = positions(breadcrumbJsonLd(site));
    assert.deepEqual(list, list.map((_, i) => i + 1));
  }
});

test("breadcrumbJsonLd links only the rungs that have a real page", () => {
  const site = makeSite();
  const items = breadcrumbJsonLd(site).itemListElement as Record<string, unknown>[];
  assert.equal(items[0].item, `${SITE_URL}/`);
  assert.equal(items[1].item, `${SITE_URL}/sites`);
  // No per-country or per-state route exists; an invented URL would 404.
  assert.ok(!("item" in items[2]), "country rung must not link to a page that does not exist");
  assert.ok(!("item" in items[3]), "state rung must not link to a page that does not exist");
  assert.equal(items[4].item, siteUrl(site));
});

// ----------------------------------------------------------------- faqJsonLd

test("faqJsonLd returns null when the record has neither access nor story", () => {
  assert.equal(faqJsonLd(makeSite()), null);
});

test("faqJsonLd returns null when access and story are present but blank", () => {
  assert.equal(faqJsonLd(makeSite({ access: "   ", story: "" })), null);
});

test("faqJsonLd never invents a how-to-get-there answer", () => {
  const node = faqJsonLd(makeSite({ story: "Legend tells of a serpent guarding the spring." }));
  assert.notEqual(node, null);
  const questions = (node!.mainEntity as { name: string }[]).map((q) => q.name);
  assert.equal(questions.length, 1, "only the sourced question is emitted");
  assert.ok(!questions.some((q) => /reach|get there/i.test(q)), "no access question without an access field");
});

test("faqJsonLd answers with the stored text verbatim", () => {
  const site = makeSite({ access: "Thanjavur railway station is 2 km away; autos run to the east gopura." });
  const node = faqJsonLd(site)!;
  const answers = (node.mainEntity as { acceptedAnswer: { text: string } }[]).map((q) => q.acceptedAnswer.text);
  assert.deepEqual(answers, [site.access]);
});

test("faqJsonLd labels the katha as legend and keeps it out of the history answer", () => {
  const site = makeSite({ access: "Bus from Madurai.", story: "The river is said to have parted here." });
  const node = faqJsonLd(site)!;
  const entries = node.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
  assert.equal(entries.length, 2);
  assert.equal(entries[0].acceptedAnswer.text, site.access);
  assert.match(entries[1].name, /legend/i, "the katha question must announce itself as legend");
  assert.equal(entries[1].acceptedAnswer.text, site.story);
  assert.ok(!entries[1].acceptedAnswer.text.includes(site.significance), "history and katha are never blended");
});

test("faqJsonLd is a FAQPage anchored to the site page", () => {
  const site = makeSite({ access: "Walk from the bazaar." });
  const node = faqJsonLd(site)!;
  assert.equal(node["@type"], "FAQPage");
  assert.equal(node["@id"], `${siteUrl(site)}#faq`);
});

// ------------------------------------------------------- cross-cutting checks

test("no builder ever emits an empty-string field", () => {
  // Every optional field present but blank: nothing may survive as "".
  const blanked = makeSite({
    alt: "",
    native: "   ",
    state: "",
    story: "  ",
    access: "",
    website: "",
    phone: "   ",
    wiki: "",
    patron: "",
  });
  const nodes = [placeJsonLd(blanked), breadcrumbJsonLd(blanked), imageJsonLd(blanked), faqJsonLd(blanked)];
  for (const node of nodes) {
    if (node === null) continue;
    for (const leaf of leaves(node)) {
      assert.notEqual(leaf.value, "", `${leaf.path} is an empty string`);
      assert.ok(
        typeof leaf.value !== "string" || leaf.value.trim() !== "",
        `${leaf.path} is whitespace only: ${JSON.stringify(leaf.value)}`
      );
      assert.notEqual(leaf.value, undefined, `${leaf.path} is undefined`);
      assert.notEqual(leaf.value, null, `${leaf.path} is null`);
    }
  }
});

test("no builder emits an empty-string field for a fully populated record", () => {
  const full = makeSite({
    alt: "Peruvudaiyar Kovil",
    story: "Said to have been raised in a single night.",
    access: "2 km from Thanjavur Junction.",
    website: "https://example.org",
    phone: "+91 4362 274 476",
    wiki: "https://en.wikipedia.org/wiki/Brihadisvara_Temple",
  });
  const nodes = [placeJsonLd(full), breadcrumbJsonLd(full), imageJsonLd(full), faqJsonLd(full)!];
  for (const leaf of nodes.flatMap((node) => leaves(node))) {
    assert.ok(
      typeof leaf.value !== "string" || leaf.value.trim() !== "",
      `${leaf.path} is blank: ${JSON.stringify(leaf.value)}`
    );
  }
});

test("serializeJsonLd drops nulls so an absent FAQ leaves no trace", () => {
  const site = makeSite();
  const parsed = JSON.parse(serializeJsonLd([placeJsonLd(site), breadcrumbJsonLd(site), faqJsonLd(site)]));
  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map((n: JsonLdNode) => n["@type"]),
    ["HinduTemple", "BreadcrumbList"]
  );
});

test("serializeJsonLd escapes < so record text cannot close the script tag", () => {
  const serialized = serializeJsonLd([placeJsonLd(makeSite({ significance: "Ends here.</script><script>x" }))]);
  assert.ok(!serialized.includes("</script>"));
  assert.ok(serialized.includes("\\u003c"));
  // Escaping must survive the round trip: the text itself is unchanged.
  assert.match(JSON.parse(serialized)[0].description, /<\/script>/);
});

test("every builder produces JSON that round-trips unchanged", () => {
  const site = makeSite({ access: "Bus from Madurai.", story: "A legend." });
  for (const node of [placeJsonLd(site), breadcrumbJsonLd(site), faqJsonLd(site)!, imageJsonLd(site)]) {
    assert.deepEqual(JSON.parse(JSON.stringify(node)), node, "no undefined values are silently dropped");
  }
});
