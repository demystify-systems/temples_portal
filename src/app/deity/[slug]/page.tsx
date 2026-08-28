import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allDeities, slugify } from "@/lib/sites";
import { PageShell } from "../../ui";
import SiteFilters from "../../SiteFilters";

/**
 * One page per canonical deity tag, built from whatever tags the corpus actually
 * carries. There is no hard-coded list here on purpose: the vocabulary grows
 * with every data wave, and a literal would quietly stop generating pages for
 * the newest deities while still passing every test.
 *
 * A corpus with no tags at all generates no pages, which is correct — the route
 * simply does not exist until the data does.
 */
export function generateStaticParams() {
  return allDeities().map(([name]) => ({ slug: slugify(name) }));
}

const find = (slug: string) => allDeities().find(([name]) => slugify(name) === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const hit = find(slug);
  if (!hit) return {};
  const [name, sites] = hit;
  return {
    title: `${name} temples`,
    description: `${sites.length} sacred site${sites.length === 1 ? "" : "s"} dedicated to ${name} in the Tirtha Atlas, searchable by era, state, dynasty and circuit.`,
  };
}

export default async function DeityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hit = find(slug);
  if (!hit) notFound();
  const [name, sites] = hit;
  const stream = sites.find((s) => s.deityGroup)?.deityGroup;
  return (
    <PageShell>
      <div className="eyebrow">Deity</div>
      <h1>{name}</h1>
      <p>
        {sites.length} site{sites.length === 1 ? "" : "s"} in the atlas tagged{" "}
        <b>{name}</b>
        {stream ? <> in the {stream} stream</> : null}. The tag is an index over
        each record&rsquo;s own dedication, which is quoted in full on the record
        itself — epithet, consort and local name intact. Search and filter within
        them.
      </p>
      {/* Scoped to this tag: the facets count and filter only its sites. */}
      <SiteFilters layout="cards" deity={name} placeholder={`Search within ${name} sites…`} />
    </PageShell>
  );
}
