import type { Metadata } from "next";
import { SITES } from "@/lib/sites";

// Derived, never hand-written: an /about page that states its own coverage has to
// recompute it, or it drifts into a claim the data no longer supports. It said
// "two tiers" with "full pilgrim detail" while 82 of those records did not keep
// the tier's promise.
const FLAGSHIP = SITES.filter((x) => (x.tier ?? "flagship") === "flagship").length;
const COMPACT = SITES.length - FLAGSHIP;
const WIKI_ONLY = SITES.filter((x) => (x.sources ?? []).every((u) => /wikipedia\.org/.test(u.u))).length;
const WIKI_ONLY_PCT = Math.round((100 * WIKI_ONLY) / SITES.length);
const NATIVE = SITES.filter((x) => x.native).length;
const DISPUTED = SITES.filter((x) => (x.disputedCircuits ?? []).length > 0).length;
const OFFICIAL = SITES.filter((x) => x.website).length;
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
      <p>The atlas documents {SITES.length} sites. {FLAGSHIP} are <b style={{ color: "var(--ink)" }}>flagship entries</b>, carrying documented history, legend, access and patron; the remaining {COMPACT} are <b style={{ color: "var(--ink)" }}>compact entries</b> holding the essentials. Those figures are recomputed on every build rather than written by hand — an earlier version of this page claimed 150 flagship records when only a fraction met the standard, and 82 were relabelled downward to match reality rather than let the label flatter them.</p>
      <p>Every record cites its sources and nothing is published without one. We would rather state a weakness than imply it away: <b style={{ color: "var(--ink)" }}>{WIKI_ONLY} records ({WIKI_ONLY_PCT}%) currently rest on English Wikipedia alone.</b> That satisfies our rule that no fact ships unsourced, but a single encyclopedia citation is thin support for the dating and dynasty attributions this project exists to get right, and reducing that number is the main editorial work ahead. {OFFICIAL} records carry an official website and {NATIVE} carry their name in a native script. Sites whose coordinates could not be sourced anywhere were excluded rather than guessed, and phone numbers appear only where published on an official temple site.</p>
      <p>Where sources disagree about whether a site belongs to a canonical list, we show the claim <i>and</i> the disagreement rather than quietly picking a side — {DISPUTED} records carry a contested attribution with its own citation. Two of the 108 Divya Desams (Tirupparkatal and Vaikuntham) are not of the earthly realm and can never appear on a map, so 106 is this gazetteer&apos;s ceiling for that circuit.</p>

      <h2>Sources & licences</h2>
      <p>Historical facts are compiled from the references cited on each entry — primarily English Wikipedia (facts restated; adapted text CC BY-SA), UNESCO World Heritage Centre listings, the Archaeological Survey of India, state temple boards (TN HR&amp;CE, Devaswom boards, AP/TS Endowments, shrine boards), and official temple trusts. Map geometry comes from Natural Earth (public domain) in its India-worldview edition; site coordinates from Wikipedia/Wikidata (CC0). &ldquo;Open in Google Maps&rdquo; links use coordinates only; no Google data is stored.</p>

      <h2>Contribute — coming in v1</h2>
      <p>The full build adds community contributions with a verification queue: photographs, timings, festival calendars, and corrections — with phone numbers accepted only when they match an official source or are call-verified, and every edit carrying a source and a &ldquo;last verified&rdquo; date.</p>

      <h2>The road ahead</h2>
      <p>Raising records off single-source citation; Wikidata and OpenStreetMap ingestion to grow from {SITES.length} toward tens of thousands; dynasty map-layers under the timeline; completing the canonical circuits; routes, timings and accommodation from official sources only; and Indic-language editions.</p>
    </PageShell>
  );
}
