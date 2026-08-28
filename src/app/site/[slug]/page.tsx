import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITES, getSite, ERAS, eraOf, appearYear, fmtYear, gmapsUrl, slugify } from "@/lib/sites";
import { placeJsonLd, breadcrumbJsonLd, faqJsonLd, serializeJsonLd } from "@/lib/jsonld";
import { siteTitle, siteDescription, siteKeywords } from "@/lib/seo";
import { PageShell } from "../../ui";
import Completeness from "../../Completeness";
// The offline pilgrim card (T-048). Imported here and nowhere else: it is all
// @media print, and only a temple page is worth carrying to a place with no signal.
import "../../print.css";

export function generateStaticParams() {
  return SITES.map((s) => ({ slug: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = getSite(slug);
  if (!s) return {};
  // These helpers draw only on `significance` — never on `story`, which is legend
  // and must not be restated as a factual summary (CLAUDE.md rule 3). `SeoSite`
  // does not declare `story` at all, so that is enforced by the type rather than
  // by convention. They return null on a short record rather than padding it.
  const title = siteTitle(s) ?? s.name;
  const description = siteDescription(s) ?? undefined;
  const keywords = siteKeywords(s);

  return {
    title: s.name,
    description,
    keywords: keywords.length ? [...keywords] : undefined,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getSite(slug);
  if (!s) notFound();
  const era = eraOf(s);
  const related = SITES.filter(
    (o) => o.id !== s.id && ((o.circuits ?? []).some((c) => (s.circuits ?? []).includes(c)) || o.dynasty === s.dynasty)
  ).slice(0, 6);

  // Place/HinduTemple + BreadcrumbList, and an FAQPage only when the record has
  // something sourced to answer with — see src/lib/jsonld.ts.
  const jsonLd = serializeJsonLd([placeJsonLd(s), breadcrumbJsonLd(s), faqJsonLd(s)]);

  return (
    <PageShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <div className="eyebrow" style={{ color: `var(--e${era + 1})` }}>{ERAS[era].name} · {s.tradition} · {s.country}</div>
      <h1>{s.name}</h1>
      {s.native && <p className="native" style={{ fontSize: 17 }}>{s.native}</p>}
      <p className="ink">{s.place}{s.state ? `, ${s.state}` : ""} · <span className="mono" style={{ fontSize: 12 }}>{s.lat.toFixed(4)}°, {s.lng.toFixed(4)}°</span></p>
      <div className="chips">
        {[s.deity, s.dynasty, s.style].map((c) => <span className="chip" key={c}>{c}</span>)}
        {(s.circuits ?? []).map((c) => {
          // A contested claim is shown, not hidden: the chip carries the circuit
          // AND the fact that the attribution is disputed, with the dispute's own
          // citation on the record below (guardrail G10).
          const dispute = (s.disputedCircuits ?? []).find((d) => d.circuit === c);
          return (
            <span className={`chip${dispute ? " chip-disputed" : ""}`} key={c}>
              {c}
              {dispute && <em title={dispute.note}>disputed</em>}
            </span>
          );
        })}
      </div>

      {(s.disputedCircuits ?? []).length > 0 && (
        <div className="disputed-note">
          <h2 style={{ marginTop: 24 }}>Contested attributions</h2>
          <p>
            This site is counted in the lists below by some sources and not others. We list the
            claim and the disagreement rather than silently picking a side.
          </p>
          <ul>
            {(s.disputedCircuits ?? []).map((d) => (
              <li key={`${d.circuit}-${d.status}`}>
                <b>{d.circuit}</b>
                {d.status === "unsourced" && <span className="mono"> · no source located</span>}
                <span> — {d.note}</span>
                {d.source && (
                  <> <a href={d.source} rel="noopener nofollow" target="_blank">source</a></>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="dates" style={{ maxWidth: 560 }}>
        <div><div className="dl">Sacred since</div><div className="dv">{fmtYear(appearYear(s))}</div><div className="ds">{s.originNote ?? "first attestation / structure"}</div></div>
        <div><div className="dl">Standing structure</div><div className="dv">{s.builtDisplay}</div><div className="ds">{s.patron ? `patron: ${s.patron}` : s.dynasty}</div></div>
      </div>

      <h2>History & significance</h2>
      <p className="ink">{s.significance}</p>
      {s.story && (
        <section className="katha" aria-label="Sthala katha — traditional account, not documented history">
          <h2>Sthala katha — the traditional account</h2>
          <p className="kathaframe">
            {/* The same sentence the map rail shows. History and katha are held
                apart in the data (rule 3) and jsonld.ts already honours it; this
                is where a READER is told which one they are looking at. */}
            What follows is the temple&rsquo;s own traditional account, transmitted
            through liturgy and local memory. It is recorded here as tradition, not
            as attested history.
          </p>
          <p>{s.story}</p>
        </section>
      )}
      {s.access && (<><h2>Reaching there</h2><p>{s.access}</p></>)}

      <div className="actions" style={{ marginTop: 20 }}>
        {s.website && <a className="primary" href={s.website} target="_blank" rel="noopener noreferrer">Official site ↗</a>}
        <a href={gmapsUrl(s)} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>
        {s.wiki && <a href={s.wiki} target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>}
        <Link href={`/#site=${s.id}`}>View on the atlas map</Link>
      </div>
      {s.phone && <p className="mono" style={{ fontSize: 13 }}>☏ {s.phone} <span style={{ color: "var(--mut)" }}>(from the official site, verified 2026-08-26)</span></p>}

      {related.length > 0 && (
        <section className="related">
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
        </section>
      )}

      <h2>Sources</h2>
      <ul className="citations" style={{ marginLeft: 18 }}>
        {s.sources.map((x) => <li key={x.u} style={{ color: "var(--ink2)", fontSize: 13.5, margin: "5px 0" }}><a href={x.u} target="_blank" rel="noopener noreferrer">{x.l}</a></li>)}
      </ul>
      <Completeness site={s} />
      <p className="mono" style={{ fontSize: 11, color: "var(--mut)" }}>coordinates: {s.verified ?? "curated"} · sources retrieved 2026-08-26 · dynasty page: <Link href={`/dynasty/${slugify(s.dynasty)}`} style={{ color: "var(--gold)" }}>{s.dynasty}</Link></p>
    </PageShell>
  );
}
