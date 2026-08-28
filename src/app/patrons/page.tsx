import type { Metadata } from "next";
import Link from "next/link";
import { SITES } from "@/lib/sites";
import { allPatrons, centurySpan, patronedSiteCount, regionSpan } from "@/lib/patrons";
import { flagOf } from "@/lib/icons";
import IndexSearch, { type IndexItem } from "../IndexSearch";
import { PageShell } from "../ui";

export const metadata: Metadata = {
  title: "Patrons",
  description:
    "The kings, queens, ministers, merchants and trusts recorded as having paid for the temples in the Tirtha Atlas — ranked by how many sites name them.",
};

/** Flags past this many are summarised — a card is a label, not a gazetteer row. */
const MAX_FLAGS = 3;

export default function Patrons() {
  const patrons = allPatrons(SITES);
  const funded = patronedSiteCount(SITES);
  const many = patrons.filter((p) => p.sites.length > 1);
  const once = patrons.filter((p) => p.sites.length === 1);

  const manyItems: readonly IndexItem[] = many.map((p) => {
    const region = regionSpan(p);
    const flagged = p.countries.slice(0, MAX_FLAGS);
    const rest = p.countries.length - flagged.length;
    return {
      key: p.slug,
      label: p.name,
      // The card's own words: the states or countries it prints, and its dates.
      keywords: [region, ...p.countries, centurySpan(p.built)].join(" "),
      node: (
        <Link className="card patroncard idxcard" href={`/patron/${p.slug}`}>
          <span className="pcount" aria-hidden="true">{p.sites.length}</span>
          <div className="cn">{p.name}</div>
          <div className="cm">{p.sites.length} sites · {region}</div>
          <div className="ictags">
            {/* The flag is decorative; the country name beside it is the fact,
                and it stays put where a font draws no flag at all. */}
            {flagged.map((c) => (
              <span className="ictag" key={c}>
                <span className="icflag" aria-hidden="true">{flagOf(c)}</span>
                {c}
              </span>
            ))}
            {rest > 0 && <span className="ictag icmore">+{rest} more</span>}
          </div>
          <div className="cy">structures {centurySpan(p.built)}</div>
        </Link>
      ),
    };
  });

  const onceItems: readonly IndexItem[] = once.map((p) => {
    const region = regionSpan(p);
    return {
      key: p.slug,
      label: p.name,
      keywords: [region, ...p.countries, centurySpan(p.built)].join(" "),
      node: (
        <li>
          <Link href={`/patron/${p.slug}`}>{p.name}</Link>
          <span className="pl-m">
            {/* `regionSpan` prints Indian states for a patron at home and
                countries for one abroad, so the flag rides beside whichever it
                is — never as the only thing naming the place. */}
            <span className="icflag" aria-hidden="true">{flagOf(p.countries[0])}</span>
            {region} · {centurySpan(p.built)}
          </span>
        </li>
      ),
    };
  });

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

      {/* One box over both lists: a reader looking for a name does not know, and
          should not have to know, whether that patron is named on one site or ten. */}
      <IndexSearch
        groups={[
          { id: "many", heading: "Named on more than one site", listClass: "cardgrid", items: manyItems },
          {
            id: "once",
            heading: "Named on a single site",
            listClass: "patronlist",
            tag: "ul",
            items: onceItems,
            note: (
              <p>
                {once.length} further patrons appear once each. The count is a measure of this atlas&apos;s
                coverage, not of a patron&apos;s generosity.
              </p>
            ),
          },
        ]}
        label="patrons"
        noun={["patron", "patrons"]}
        placeholder="Search patrons — Rajaraja, Ahilyabai…"
      />
    </PageShell>
  );
}
