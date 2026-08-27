import type { Metadata } from "next";
import Link from "next/link";
import { SITES } from "@/lib/sites";
import { allPatrons, centurySpan, patronedSiteCount, regionSpan } from "@/lib/patrons";
import { PageShell } from "../ui";

export const metadata: Metadata = {
  title: "Patrons",
  description:
    "The kings, queens, ministers, merchants and trusts recorded as having paid for the temples in the Tirtha Atlas — ranked by how many sites name them.",
};

export default function Patrons() {
  const patrons = allPatrons(SITES);
  const funded = patronedSiteCount(SITES);
  const many = patrons.filter((p) => p.sites.length > 1);
  const once = patrons.filter((p) => p.sites.length === 1);

  return (
    <PageShell>
      <div className="eyebrow">Patronage</div>
      <h1>Who paid for these temples</h1>
      <p className="ink">
        A temple is a ledger in stone. {patrons.length} patrons — kings and queens, ministers and generals,
        merchants, abbots, widows and modern trusts — are named across the atlas as having built, rebuilt or
        gilded a sacred site.
      </p>

      <div className="patronnote">
        <p>
          This index is read from the free-text <span className="mono">patron</span> field, which{" "}
          <b>{funded} of the {SITES.length} records</b> carry. It is therefore partial — a site with no patron
          listed is not a site without a patron, only one whose funder the atlas has not yet sourced. Where a
          record clearly names more than one benefactor the entry is split; spellings that differ only by title
          or by a note of what was paid for are treated as one person, and every spelling used is reproduced on
          that patron&apos;s own page. No patron&apos;s own dates, house or biography is asserted anywhere here:
          the corpus holds no sourced field for them, so the centuries shown are those of the buildings, not of
          the people.
        </p>
      </div>

      <h2>Named on more than one site</h2>
      <div className="cardgrid">
        {many.map((p) => (
          <Link className="card patroncard" href={`/patron/${p.slug}`} key={p.slug}>
            <span className="pcount" aria-hidden="true">{p.sites.length}</span>
            <div className="cn">{p.name}</div>
            <div className="cm">{p.sites.length} sites · {regionSpan(p)}</div>
            <div className="cy">structures {centurySpan(p.built)}</div>
          </Link>
        ))}
      </div>

      <h2>Named on a single site</h2>
      <p>
        {once.length} further patrons appear once each. The count is a measure of this atlas&apos;s coverage, not
        of a patron&apos;s generosity.
      </p>
      <ul className="patronlist">
        {once.map((p) => (
          <li key={p.slug}>
            <Link href={`/patron/${p.slug}`}>{p.name}</Link>
            <span className="pl-m">{regionSpan(p)} · {centurySpan(p.built)}</span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
