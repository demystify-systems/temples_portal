import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITES, getSite, ERAS, eraOf, appearYear, fmtYear, gmapsUrl, slugify } from "@/lib/sites";
import { PageShell } from "../../ui";

export function generateStaticParams() {
  return SITES.map((s) => ({ slug: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = getSite(slug);
  if (!s) return {};
  const desc = `${s.deity} · ${s.place}, ${s.country} · ${s.builtDisplay} (${s.dynasty}). ${s.significance.slice(0, 150)}…`;
  return { title: s.name, description: desc, openGraph: { title: `${s.name} · Tirtha Atlas`, description: desc } };
}

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getSite(slug);
  if (!s) notFound();
  const era = eraOf(s);
  const related = SITES.filter(
    (o) => o.id !== s.id && ((o.circuits ?? []).some((c) => (s.circuits ?? []).includes(c)) || o.dynasty === s.dynasty)
  ).slice(0, 6);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": s.tradition === "Hindu" ? "HinduTemple" : s.tradition === "Buddhist" ? "BuddhistTemple" : "PlaceOfWorship",
    name: s.name,
    alternateName: s.alt,
    description: s.significance,
    geo: { "@type": "GeoCoordinates", latitude: s.lat, longitude: s.lng },
    address: { "@type": "PostalAddress", addressLocality: s.place, addressRegion: s.state, addressCountry: s.country },
    url: s.website,
    sameAs: [s.wiki].filter(Boolean),
  };

  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="eyebrow" style={{ color: `var(--e${era + 1})` }}>{ERAS[era].name} · {s.tradition} · {s.country}</div>
      <h1>{s.name}</h1>
      {s.native && <p className="native" style={{ fontSize: 17 }}>{s.native}</p>}
      <p className="ink">{s.place}{s.state ? `, ${s.state}` : ""} · <span className="mono" style={{ fontSize: 12 }}>{s.lat.toFixed(4)}°, {s.lng.toFixed(4)}°</span></p>
      <div className="chips">
        {[s.deity, s.dynasty, s.style, ...(s.circuits ?? [])].map((c) => <span className="chip" key={c}>{c}</span>)}
      </div>
      <div className="dates" style={{ maxWidth: 560 }}>
        <div><div className="dl">Sacred since</div><div className="dv">{fmtYear(appearYear(s))}</div><div className="ds">{s.originNote ?? "first attestation / structure"}</div></div>
        <div><div className="dl">Standing structure</div><div className="dv">{s.builtDisplay}</div><div className="ds">{s.patron ? `patron: ${s.patron}` : s.dynasty}</div></div>
      </div>

      <h2>History & significance</h2>
      <p className="ink">{s.significance}</p>
      <h2>Sthala katha — the legend</h2>
      <p><i>{s.story}</i></p>
      {s.access && (<><h2>Reaching there</h2><p>{s.access}</p></>)}

      <div className="actions" style={{ marginTop: 20 }}>
        {s.website && <a className="primary" href={s.website} target="_blank" rel="noopener noreferrer">Official site ↗</a>}
        <a href={gmapsUrl(s)} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>
        {s.wiki && <a href={s.wiki} target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>}
        <Link href={`/#site=${s.id}`}>View on the atlas map</Link>
      </div>
      {s.phone && <p className="mono" style={{ fontSize: 13 }}>☏ {s.phone} <span style={{ color: "var(--mut)" }}>(from the official site, verified 2026-08-26)</span></p>}

      {related.length > 0 && (
        <>
          <h2>Related sites</h2>
          <div className="cardgrid">
            {related.map((r) => (
              <Link className="card" href={`/site/${r.id}`} key={r.id}>
                <div className="cn">{r.name}</div>
                <div className="cm">{r.place} · {r.country}</div>
                <div className="cy" style={{ color: `var(--e${eraOf(r) + 1})` }}>{r.builtDisplay}</div>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2>Sources</h2>
      <ul style={{ marginLeft: 18 }}>
        {s.sources.map((x) => <li key={x.u} style={{ color: "var(--ink2)", fontSize: 13.5, margin: "5px 0" }}><a href={x.u} target="_blank" rel="noopener noreferrer">{x.l}</a></li>)}
      </ul>
      <p className="mono" style={{ fontSize: 11, color: "var(--mut)" }}>coordinates: {s.verified ?? "curated"} · sources retrieved 2026-08-26 · dynasty page: <Link href={`/dynasty/${slugify(s.dynasty)}`} style={{ color: "var(--gold)" }}>{s.dynasty}</Link></p>
    </PageShell>
  );
}
