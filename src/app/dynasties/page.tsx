import type { Metadata } from "next";
import Link from "next/link";
import { allDynasties, slugify, type Site } from "@/lib/sites";
import { ERAS, eraIndex } from "@/lib/site-utils";
import { centurySpan } from "@/lib/patrons";
import { ICON_VIEWBOX, eraVar, flagOf, traditionIcon } from "@/lib/icons";
import IndexSearch, { type IndexItem } from "../IndexSearch";
import { PageShell } from "../ui";

export const metadata: Metadata = { title: "Dynasties & patrons", description: "The dynasties, kingdoms and eras that raised the sacred architecture of the Indic world." };

/** Flags past this many are summarised — a card is a label, not a gazetteer row. */
const MAX_FLAGS = 3;

const distinct = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

/**
 * Everything a dynasty card shows, read off its own sites and nothing else.
 *
 * There is no canonical emblem for a dynasty and the corpus records none, so a
 * card gets structural devices only: how many sites, the century span of those
 * sites, the era colour band from the validated palette, and the traditions and
 * countries its own records name. Inventing a Chola crest would be inventing a
 * field (constitution rule 2).
 */
const summarise = (sites: readonly Site[]) => {
  const from = Math.min(...sites.map((s) => s.built[0]));
  const to = Math.max(...sites.map((s) => s.built[1]));
  return {
    span: centurySpan([from, to]),
    era: eraIndex(from),
    traditions: distinct(sites.map((s) => s.tradition)),
    countries: distinct(sites.map((s) => s.country)),
  };
};

export default function Dynasties() {
  const dyns = allDynasties();

  const items: readonly IndexItem[] = dyns.map(([name, sites]) => {
    const { span, era, traditions, countries } = summarise(sites);
    const flagged = countries.slice(0, MAX_FLAGS);
    const rest = countries.length - flagged.length;
    return {
      key: name,
      label: name,
      // Exactly the other words printed on the card below, so every hit is
      // visible on screen — "Cambodia" finding "Khmer" is explained by the card.
      keywords: [...traditions, ...countries, span, ERAS[era]?.name ?? ""].join(" "),
      node: (
        <Link className="card idxcard" href={`/dynasty/${slugify(name)}`}>
          {/* Decorative: the century span beside it is the text that carries the date. */}
          <span className="erabar" style={{ background: eraVar(era) }} aria-hidden="true" />
          <div className="cn">{name}</div>
          <div className="cm">{sites.length} site{sites.length === 1 ? "" : "s"} · {span}</div>
          <div className="ictags">
            {traditions.map((t) => (
              <span className="ictag" key={t}>
                <svg className="shape" viewBox={ICON_VIEWBOX} aria-hidden="true" focusable="false">
                  <path d={traditionIcon(t).d} />
                </svg>
                {t}
              </span>
            ))}
          </div>
          <div className="ictags">
            {flagged.map((c) => (
              <span className="ictag" key={c}>
                <span className="icflag" aria-hidden="true">{flagOf(c)}</span>
                {c}
              </span>
            ))}
            {rest > 0 && <span className="ictag icmore">+{rest} more</span>}
          </div>
        </Link>
      ),
    };
  });

  return (
    <PageShell>
      <div className="eyebrow">Chronology</div>
      <h1>Dynasties & patrons</h1>
      <p>
        Every standing structure in the atlas is attributed to the dynasty or era that raised it. Choose one to
        see its temples. The coloured band is the era of the earliest structure; the shape beside a tradition is
        the same one that tradition carries on the map.
      </p>
      <IndexSearch
        groups={[{ id: "dynasties", listClass: "cardgrid", items }]}
        label="dynasties"
        noun={["dynasty", "dynasties"]}
        placeholder="Search dynasties — Chola, Khmer, Malla…"
      />
    </PageShell>
  );
}
