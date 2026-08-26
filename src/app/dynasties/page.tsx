import type { Metadata } from "next";
import Link from "next/link";
import { allDynasties, slugify } from "@/lib/sites";
import { PageShell } from "../ui";

export const metadata: Metadata = { title: "Dynasties & patrons", description: "The dynasties, kingdoms and eras that raised the sacred architecture of the Indic world." };

export default function Dynasties() {
  const dyns = allDynasties();
  return (
    <PageShell>
      <div className="eyebrow">Chronology</div>
      <h1>Dynasties & patrons</h1>
      <p>Every standing structure in the atlas is attributed to the dynasty or era that raised it. Choose one to see its temples.</p>
      <div className="cardgrid">
        {dyns.map(([name, sites]) => (
          <Link className="card" href={`/dynasty/${slugify(name)}`} key={name}>
            <div className="cn">{name}</div>
            <div className="cm">{sites.length} site{sites.length > 1 ? "s" : ""}</div>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
