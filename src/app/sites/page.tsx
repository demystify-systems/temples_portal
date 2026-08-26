import type { Metadata } from "next";
import Link from "next/link";
import { SITES, fmtYear, eraOf } from "@/lib/sites";
import { PageShell } from "../ui";

export const metadata: Metadata = { title: "Gazetteer", description: "All sacred sites in the Tirtha Atlas, by country — with era, dynasty, and tradition." };

export default function Gazetteer() {
  const countries = [...new Set(SITES.map((s) => s.country))].sort();
  return (
    <PageShell>
      <div className="eyebrow">Gazetteer</div>
      <h1>All {SITES.length} sites, by country</h1>
      <p>Every entry links to its full cited page. Colour dot = construction era of the standing structure.</p>
      {countries.map((c) => {
        const rows = SITES.filter((s) => s.country === c).sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section key={c}>
            <h2>{c} · {rows.length}</h2>
            <div className="tablewrap">
              <table className="gz">
                <thead><tr><th>Site</th><th>Place</th><th>Tradition</th><th>Dynasty</th><th>Built</th></tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td><span className="dot" style={{ background: `var(--e${eraOf(s) + 1})`, marginRight: 8 }} /><Link href={`/site/${s.id}`}>{s.name}</Link></td>
                      <td>{s.place}{s.state ? `, ${s.state}` : ""}</td>
                      <td>{s.tradition}</td>
                      <td>{s.dynasty}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtYear(s.built[0])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </PageShell>
  );
}
