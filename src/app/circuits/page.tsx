import type { Metadata } from "next";
import Link from "next/link";
import { allCircuits, slugify } from "@/lib/sites";
import { ICON_VIEWBOX, ROUTE_VIEWBOX, flagOf, routeIcon, traditionIcon } from "@/lib/icons";
import IndexSearch, { type IndexItem } from "../IndexSearch";
import { PageShell } from "../ui";

export const metadata: Metadata = { title: "Sacred circuits", description: "Jyotirlingas, Char Dham, Shakti Peethas, Divya Desams and other pilgrimage circuits mapped in the Tirtha Atlas." };

/** Flags past this many are summarised — a card is a label, not a gazetteer row. */
const MAX_FLAGS = 3;

const distinct = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

export default function Circuits() {
  const circuits = allCircuits();

  const items: readonly IndexItem[] = circuits.map(([name, sites]) => {
    const traditions = distinct(sites.map((s) => s.tradition));
    const countries = distinct(sites.map((s) => s.country));
    const flagged = countries.slice(0, MAX_FLAGS);
    const rest = countries.length - flagged.length;
    return {
      key: name,
      label: name,
      // The rest of the words the card prints, and nothing beyond them.
      keywords: [...traditions, ...countries].join(" "),
      node: (
        <Link className="card idxcard" href={`/circuit/${slugify(name)}`}>
          <div className="cn">{name}</div>
          <div className="cm">
            {/* Decorative. It says "more than one member" and nothing else: the
                corpus records circuit membership and no order, so the glyph must
                not imply a route direction. The count beside it is the fact. */}
            <svg className="icroute" viewBox={ROUTE_VIEWBOX} aria-hidden="true" focusable="false">
              <path d={routeIcon(sites.length).d} />
            </svg>
            {sites.length} site{sites.length === 1 ? "" : "s"} in the atlas
          </div>
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
      <div className="eyebrow">Circuits</div>
      <h1>Sacred circuits & networks</h1>
      <p>The great pilgrimage networks that organise India&apos;s sacred geography — each circuit page lists its member sites in the atlas. Seed coverage grows toward the complete circuits (all 12 Jyotirlingas are in; the 108 Divya Desams complete in the next phase).</p>
      <IndexSearch
        groups={[{ id: "circuits", listClass: "cardgrid", items }]}
        label="circuits"
        noun={["circuit", "circuits"]}
        placeholder="Search circuits — Jyotirlinga, Char Dham…"
      />
    </PageShell>
  );
}
