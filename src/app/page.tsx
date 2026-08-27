import Link from "next/link";
import AtlasClient from "./AtlasClient";
import { SITES } from "@/lib/sites";

export default function Home() {
  return (
    <div className="app">
      <header className="bar">
        <Link href="/" className="brand" aria-label="Tirtha Atlas home">
          <svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round"><path d="M16 3 L16 7" /><path d="M12 9 Q16 4 20 9" /><path d="M9 13 Q16 6 23 13" /><path d="M6 18 Q16 8 26 18" /><path d="M8 18 L8 27 M16 14 L16 27 M24 18 L24 27" /><path d="M4 27 L28 27" /></g></svg>
          <span className="t">Tirtha <b>Atlas</b></span>
        </Link>
        <div className="tag">The sacred geography of the Indic world — every site mapped, dated, storied, and cited. From Gandhara to Angkor, Kailasa to Borobudur.</div>
        <div className="hstats">
          <span><b>{SITES.length}</b> sites</span><span><b>{new Set(SITES.map((s) => s.country)).size}</b> countries</span><span><b>4</b> traditions</span><span><b>{Math.round((2030 - Math.min(...SITES.map((s) => s.built[0]))) / 100)}</b> centuries</span>
        </div>
        <button className="hbtn" id="ixbtn" type="button">Index</button>
        <Link className="hbtn" href="/sites">Gazetteer</Link>
        <Link className="hbtn" href="/circuits">Circuits</Link>
        <Link className="hbtn" href="/about">About & sources</Link>
      </header>
      <AtlasClient />
    </div>
  );
}
