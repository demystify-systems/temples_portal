import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allCircuits, slugify, eraOf } from "@/lib/sites";
import { PageShell } from "../../ui";

export function generateStaticParams() {
  return allCircuits().map(([name]) => ({ slug: slugify(name) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const hit = allCircuits().find(([name]) => slugify(name) === slug);
  if (!hit) return {};
  return { title: hit[0], description: `${hit[0]} — member sites mapped and cited in the Tirtha Atlas.` };
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
      <p>{sites.length} site{sites.length > 1 ? "s" : ""} of this circuit are in the current seed atlas.</p>
      <div className="cardgrid">
        {sites.map((s) => (
          <Link className="card" href={`/site/${s.id}`} key={s.id}>
            <div className="cn">{s.name}</div>
            <div className="cm">{s.place} · {s.country}</div>
            <div className="cy" style={{ color: `var(--e${eraOf(s) + 1})` }}>{s.builtDisplay}</div>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
