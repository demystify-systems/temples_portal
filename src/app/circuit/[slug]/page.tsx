import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allCircuits, slugify } from "@/lib/sites";
import { PageShell } from "../../ui";
import SiteFilters from "../../SiteFilters";

export function generateStaticParams() {
  return allCircuits().map(([name]) => ({ slug: slugify(name) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const hit = allCircuits().find(([name]) => slugify(name) === slug);
  if (!hit) return {};
  return { title: hit[0], description: `${hit[0]} — member sites mapped and cited in the Tirtha Atlas, searchable by deity, era, state and tradition.` };
}

export default async function CircuitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hit = allCircuits().find(([name]) => slugify(name) === slug);
  if (!hit) notFound();
  const [name, sites] = hit;
  return (
    <PageShell>
      <div className="eyebrow">Circuit</div>
      <h1>{name}</h1>
      <p>{sites.length} site{sites.length > 1 ? "s" : ""} of this circuit are in the current seed atlas. Search and filter within them.</p>
      {/* Scoped to this circuit: the facets count and filter only its members. */}
      <SiteFilters layout="cards" circuit={name} placeholder={`Search within ${name}…`} />
    </PageShell>
  );
}
