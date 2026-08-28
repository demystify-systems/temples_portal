import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "./SiteHeader";
import { ATLAS_STATS } from "@/lib/generated/atlas-stats";

export const metadata: Metadata = {
  title: "Not found",
  // A 404 that search engines index is a 404 that outranks the real page.
  robots: { index: false, follow: true },
};

/**
 * The 404.
 *
 * Written in the same register as `EmptyState`: it says what we do not have,
 * never what does not exist. A URL we cannot resolve is a fact about this
 * atlas's routing, not about whether a temple is real — the same posture
 * `completeness.ts` takes about an absent field, applied to an absent page.
 *
 * It offers the two things that actually recover the visit — the gazetteer and
 * the map — rather than a dead end with a back button.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader stats={ATLAS_STATS} />
      <main className="page">
        <p className="eyebrow">404</p>
        <h1>We have no page at this address</h1>
        <p className="ink">
          That may be a mistyped link, a page that has moved, or a site the atlas
          has not recorded yet. It is not a statement about the place itself —
          only about what we have published.
        </p>
        <p>
          The atlas holds {ATLAS_STATS.sites.toLocaleString()} sourced records across{" "}
          {ATLAS_STATS.countries} countries. Two ways back in:
        </p>
        <div className="actions" style={{ marginTop: 18 }}>
          <Link className="primary" href="/sites">Search the gazetteer →</Link>
          <Link href="/">Open the map</Link>
          <Link href="/about">How a fact reaches the atlas</Link>
        </div>
      </main>
    </>
  );
}
