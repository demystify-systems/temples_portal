import type { Metadata } from "next";
import { SITES } from "@/lib/sites";
import { PageShell } from "../ui";

export const metadata: Metadata = { title: "About & methodology", description: "What Tirtha Atlas is, how the data is verified and cited, the map boundary policy, and how contribution will work." };

export default function About() {
  return (
    <PageShell>
      <div className="eyebrow">Prototype · v0.1 · August 2026</div>
      <h1>About Tirtha Atlas</h1>
      <p className="ink">An interactive atlas of the sacred Indic world — Hindu, Buddhist, Jain, and Sikh sites across India and the wider civilisational sphere it shaped: Nepal, Bhutan, Sri Lanka, Pakistan, Afghanistan, Bangladesh, Myanmar, Thailand, Cambodia, Laos, Vietnam, Malaysia, Singapore, and Indonesia. Scrub the timeline to watch two and a half millennia of temple building unfold; every site carries its history, its legend (marked as <i>katha</i>, distinct from documented history), pilgrim practicalities, and full citations.</p>

      <h2>How to read the map</h2>
      <p><b style={{ color: "var(--ink)" }}>Colour is the construction era</b> of the standing structure; <b style={{ color: "var(--ink)" }}>shape is the tradition</b> — circle Hindu, square Buddhist, diamond Jain, triangle Sikh. While scrubbing time, a hollow mark means the site was already sacred (first attestation or tradition) but today&apos;s structure was not yet built; the mark fills in the year construction of the standing structure began.</p>

      <h2>Map & boundary policy</h2>
      <p className="ink">All maps on this site depict the external boundaries of India as per the position of the Government of India, using the Natural Earth &ldquo;India worldview&rdquo; boundary edition: the entire Union Territories of Jammu &amp; Kashmir and Ladakh — including the areas under Pakistani and Chinese occupation — and the full state of Arunachal Pradesh are shown as Indian territory. Sacred sites located in occupied territory (e.g. Sharada Peeth) are listed under India accordingly.</p>

      <h2>Data & verification</h2>
      <p>This seed edition documents {SITES.length} flagship sites. Coordinates, construction periods, dynasties, and official websites were cross-checked against English Wikipedia and official sources on 2026-08-26; 148 of {SITES.length} coordinates are Wikipedia-verified (2 are flagged for field verification in their entries). Phone numbers appear only where published on an official temple site — never from third-party listings. Every entry cites its sources; nothing is published without one.</p>

      <h2>Sources & licences</h2>
      <p>Historical facts are compiled from the references cited on each entry — primarily English Wikipedia (facts restated; adapted text CC BY-SA), UNESCO World Heritage Centre listings, the Archaeological Survey of India, state temple boards (TN HR&amp;CE, Devaswom boards, AP/TS Endowments, shrine boards), and official temple trusts. Map geometry comes from Natural Earth (public domain) in its India-worldview edition; site coordinates from Wikipedia/Wikidata (CC0). &ldquo;Open in Google Maps&rdquo; links use coordinates only; no Google data is stored.</p>

      <h2>Contribute — coming in v1</h2>
      <p>The full build adds community contributions with a verification queue: photographs, timings, festival calendars, and corrections — with phone numbers accepted only when they match an official source or are call-verified, and every edit carrying a source and a &ldquo;last verified&rdquo; date.</p>

      <h2>The road ahead</h2>
      <p>Wikidata/OSM ingestion to grow from {SITES.length} to thousands of sites; dynasty map-layers under the timeline; complete circuits (all 108 Divya Desams next); routes and accommodation from official sources; Indic-language editions.</p>
    </PageShell>
  );
}
