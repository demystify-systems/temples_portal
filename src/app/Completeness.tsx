import Link from "next/link";
import { completenessOf, listLabels, type Recorded } from "@/lib/completeness";

/**
 * The honest badge (BACKLOG B10 + B12).
 *
 * 1,058 of the 1,126 records are compact, so most pages in this atlas are thin.
 * A thin page must never read as broken, as an oversight, or — the failure that
 * would actually damage the project — as a claim that the missing fact is
 * unknown. Every word below says the same thing: WE HAVE NOT SOURCED IT YET.
 * The gap is in our citations, and it is ours to close.
 *
 * That is why the copy here is load-bearing and the styling is not. The words
 * this badge must never reach for are statements about the world rather than
 * about our sourcing; completeness.test.ts holds the list and fails on any of
 * them appearing in a field label or in the copy below.
 */
export default function Completeness({ site }: { readonly site: Recorded }) {
  const c = completenessOf(site);

  return (
    <aside className="completeness" aria-label="What this record has sourced">
      <p className="clabel">
        <b>{c.tierLabel}</b> · {c.sourcedCount} of {c.total} fields sourced
      </p>
      <div className="cbar" aria-hidden="true"><span style={{ width: `${c.pct}%` }} /></div>

      {c.absent.length === 0 ? (
        <p className="cnote">
          Every field on this scale is present and carries a citation. Corrections
          are still welcome — <Link href="/about">how a fact reaches the atlas</Link>.
        </p>
      ) : (
        <>
          <p className="cmiss">Not yet sourced: {listLabels(c.absent)}.</p>
          <p className="cnote">
            Those are gaps in our citations, not in the record of the site. A field
            appears here only once we can cite it, so an absent one means the sourcing
            is still to do — most of these facts are well attested somewhere we have
            not read yet: a gazetteer, an inscription volume, the temple&rsquo;s own
            office. We omit rather than guess.
            {!c.meetsTier && (
              <> This record is also labelled above what it has sourced; that label gets
              corrected downward when we notice, never papered over.</>
            )}
          </p>
          <p className="ccta">
            Most useful next: <b>{c.next!.label}</b>. If you have it in a published source,{" "}
            <Link href="/about">see how a fact reaches the atlas</Link>.
          </p>
        </>
      )}
    </aside>
  );
}
