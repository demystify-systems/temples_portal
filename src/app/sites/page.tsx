import type { Metadata } from "next";
import { SITES } from "@/lib/sites";
import { PageShell } from "../ui";
import SiteFilters from "../SiteFilters";

export const metadata: Metadata = { title: "Gazetteer", description: "All sacred sites in the Tirtha Atlas, by country — with era, dynasty, and tradition. Searchable and filterable by deity, tradition, era, country, state and pilgrim circuit." };

export default function Gazetteer() {
  return (
    <PageShell>
      <div className="eyebrow">Gazetteer</div>
      <h1>All {SITES.length} sites, by country</h1>
      <p>Search by name, deity, place, dynasty or style. Transliteration variants are treated as one word — <i>shree</i>, <i>shri</i> and <i>sri</i> all match, and a Perumal shrine answers to <i>Vishnu</i>. Every entry links to its full cited page. Colour dot = construction era of the standing structure.</p>
      <SiteFilters layout="table" />
    </PageShell>
  );
}
