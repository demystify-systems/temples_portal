import type { Metadata } from "next";
import Link from "next/link";
import { allDeities, allDeityGroups, slugify, SITES } from "@/lib/sites";
import { PageShell } from "../ui";

export const metadata: Metadata = {
  title: "Deities",
  description: "Every deity the sacred sites of the Indic world are dedicated to — Shiva, Vishnu, the Goddess in her forms, the Tirthankaras, the Buddhas and the Gurus.",
};

export default function Deities() {
  const deities = allDeities();
  const groups = allDeityGroups();
  const tagged = SITES.filter((s) => (s.deities ?? []).length > 0).length;
  const untagged = SITES.length - tagged;

  return (
    <PageShell>
      <div className="eyebrow">Dedication</div>
      <h1>Deities</h1>
      <p>
        Each record quotes its dedication as its source gives it — &ldquo;Meenakshi
        (Parvati) &amp; Sundareswarar (Shiva)&rdquo; — which is the interesting
        part and a hopeless thing to filter on. These canonical tags sit beside
        that text as an index into it. Choose one to see its sites.
      </p>

      {deities.length === 0 ? (
        /**
         * The honest empty state. It is reachable: the tags are generated onto
         * the corpus by a separate step, so a freshly merged data wave can sit
         * here untagged for a while. Saying so beats an empty grid.
         */
        <p className="emptynote">
          No deity tags in the corpus yet. The tags are generated from
          <code> data/vocab/deity.json</code>; until that step has run over the
          current data, sites remain searchable by name, place, dynasty and era.
        </p>
      ) : (
        <>
          <h2>Streams</h2>
          <p>
            The broad traditions the tags roll up to. Shaiva and Shakta are both
            &ldquo;Hindu&rdquo;; the stream is what tells them apart.
          </p>
          <div className="cardgrid">
            {groups.map(([name, sites]) => (
              <Link className="card" href={`/sites?group=${encodeURIComponent(name)}`} key={name}>
                <div className="cn">{name}</div>
                <div className="cm">{sites.length} site{sites.length === 1 ? "" : "s"}</div>
              </Link>
            ))}
          </div>

          <h2>Every deity</h2>
          <p>
            {deities.length} tags across {tagged} of {SITES.length} records.
            {untagged > 0 ? (
              <>
                {" "}The other {untagged} are not gaps: their dedication names no
                figure — relic stupas, monastic universities, a river confluence,
                &ldquo;Parabrahma, worshipped without image&rdquo; — and a tag
                there would be an invention.
              </>
            ) : null}
          </p>
          <div className="cardgrid">
            {deities.map(([name, sites]) => (
              <Link className="card" href={`/deity/${slugify(name)}`} key={name}>
                <div className="cn">{name}</div>
                <div className="cm">{sites.length} site{sites.length === 1 ? "" : "s"}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
