import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITES, eraOf } from "@/lib/sites";
import { allPatrons, centurySpan, findPatron, patronSources, regionSpan } from "@/lib/patrons";
import { PageShell } from "../../ui";

const patrons = () => allPatrons(SITES);

const plural = (n: number, singular: string, many = `${singular}s`) => `${n} ${n === 1 ? singular : many}`;

export function generateStaticParams() {
  return patrons().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const patron = findPatron(patrons(), slug);
  if (!patron) return {};
  const desc = `${patron.name} is named as patron on ${plural(patron.sites.length, "site")} in the Tirtha Atlas — ${regionSpan(patron)}, structures ${centurySpan(patron.built)}. Every attribution cited.`;
  return {
    title: `${patron.name} — patron`,
    description: desc,
    openGraph: { title: `${patron.name} · Tirtha Atlas`, description: desc },
  };
}

export default async function PatronPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const patron = findPatron(patrons(), slug);
  if (!patron) notFound();

  const byState = patron.states.length > 0;
  const regions = byState ? patron.states : patron.countries;
  const span =
    regions.length > 1
      ? `, across ${plural(regions.length, byState ? "state" : "country", byState ? "states" : "countries")}`
      : "";
  const lead = `${plural(patron.sites.length, "site")} in the atlas ${patron.sites.length === 1 ? "names" : "name"} ${patron.name} as patron${span}.`;
  const citations = patronSources(patron);
  // Only worth showing when the records disagree with each other or with the label.
  const showVariants = patron.variants.length > 1 || patron.variants[0] !== patron.name;

  return (
    <PageShell>
      <div className="eyebrow">Patron</div>
      <h1>{patron.name}</h1>
      <p className="ink">{lead}</p>

      <div className="chips">
        {regions.map((r) => <span className="chip" key={r}>{r}</span>)}
        {byState && patron.countries.map((c) => <span className="chip gold" key={c}>{c}</span>)}
      </div>

      <div className="dates pdates">
        <div>
          <div className="dl">Sites here</div>
          <div className="dv">{patron.sites.length}</div>
          <div className="ds">{patron.sites.length === 1 ? "record" : "records"} naming this patron</div>
        </div>
        <div>
          <div className="dl">Geographic span</div>
          <div className="dv">{regionSpan(patron)}</div>
          <div className="ds">from the site records</div>
        </div>
        <div>
          <div className="dl">Structures span</div>
          <div className="dv">{centurySpan(patron.built)}</div>
          <div className="ds">the buildings&apos; dates, not the patron&apos;s</div>
        </div>
      </div>

      <p>
        These centuries are the minimum and maximum of the <span className="mono">built</span> ranges of the
        sites below — several of which have older cores this patron did not raise. The atlas states no dates for
        the patron: it carries no sourced field for them.
      </p>

      <h2>Sites</h2>
      <div className="cardgrid">
        {patron.sites.map((s) => (
          <Link className="card" href={`/site/${s.id}`} key={s.id}>
            <div className="cn">{s.name}</div>
            <div className="cm">{s.place}{s.state ? `, ${s.state}` : ""} · {s.country}</div>
            <div className="cy" style={{ color: `var(--e${eraOf(s) + 1})` }}>{s.builtDisplay}</div>
          </Link>
        ))}
      </div>

      {showVariants && (
        <>
          <h2>As the records write it</h2>
          <p>
            The <span className="mono">patron</span> field is free text, so the same person is written several
            ways. These are the exact forms behind this page — nothing here is a normalisation you cannot check.
          </p>
          <ul className="patronvariants">
            {patron.variants.map((v) => <li className="mono" key={v}>{v}</li>)}
          </ul>
        </>
      )}

      <h2>Sources</h2>
      <p>
        {plural(citations.length, "citation")} across {plural(patron.sites.length, "site record")}. The
        attribution above is only as good as these.
      </p>
      <ul className="srclist">
        {patron.sites.map((s) => (
          <li key={s.id}>
            <Link href={`/site/${s.id}`}>{s.name}</Link>
            {" — "}
            {s.sources.map((x, i) => (
              <span key={x.u}>
                {i > 0 ? " · " : ""}
                <a href={x.u} target="_blank" rel="noopener noreferrer">{x.l}</a>
              </span>
            ))}
          </li>
        ))}
      </ul>

      <div className="actions" style={{ marginTop: 20 }}>
        <Link href="/patrons">All patrons</Link>
        <Link href="/sites">Gazetteer</Link>
        <Link href="/">Atlas map</Link>
      </div>
      <p className="mono" style={{ fontSize: 11, color: "var(--mut)" }}>
        derived from the patron field of {plural(patron.sites.length, "record")} · no patron biography is stored
        or inferred · sources retrieved 2026-08-26
      </p>
    </PageShell>
  );
}
