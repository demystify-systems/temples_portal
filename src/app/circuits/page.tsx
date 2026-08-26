import type { Metadata } from "next";
import Link from "next/link";
import { allCircuits, slugify } from "@/lib/sites";
import { PageShell } from "../ui";

export const metadata: Metadata = { title: "Sacred circuits", description: "Jyotirlingas, Char Dham, Shakti Peethas, Divya Desams and other pilgrimage circuits mapped in the Tirtha Atlas." };

export default function Circuits() {
  const circuits = allCircuits();
  return (
    <PageShell>
      <div className="eyebrow">Circuits</div>
      <h1>Sacred circuits & networks</h1>
      <p>The great pilgrimage networks that organise India&apos;s sacred geography — each circuit page lists its member sites in the atlas. Seed coverage grows toward the complete circuits (all 12 Jyotirlingas are in; the 108 Divya Desams complete in the next phase).</p>
      <div className="cardgrid">
        {circuits.map(([name, sites]) => (
          <Link className="card" href={`/circuit/${slugify(name)}`} key={name}>
            <div className="cn">{name}</div>
            <div className="cm">{sites.length} site{sites.length > 1 ? "s" : ""} in the atlas</div>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
