import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allDynasties, slugify } from "@/lib/sites";
import { PageShell } from "../../ui";
import SiteFilters from "../../SiteFilters";

export function generateStaticParams() {
  return allDynasties().map(([name]) => ({ slug: slugify(name) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const hit = allDynasties().find(([name]) => slugify(name) === slug);
  if (!hit) return {};
  return { title: `${hit[0]} temples`, description: `Sacred architecture of the ${hit[0]} era in the Tirtha Atlas, searchable by deity, era, state and tradition.` };
}

export default async function DynastyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hit = allDynasties().find(([name]) => slugify(name) === slug);
  if (!hit) notFound();
  const [name, sites] = hit;
  return (
    <PageShell>
      <div className="eyebrow">Dynasty</div>
      <h1>{name}</h1>
      <p>{sites.length} site{sites.length > 1 ? "s" : ""} in the atlas attributed to the {name} era. Search and filter within them.</p>
      {/* Scoped to this dynasty: the facets count and filter only its sites. */}
      <SiteFilters layout="cards" dynasty={name} placeholder={`Search within ${name} sites…`} />
    </PageShell>
  );
}
