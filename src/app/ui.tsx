import Link from "next/link";

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <nav className="top" aria-label="Main">
        <Link href="/" className="brand" style={{ gap: 8 }}>
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><g fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round"><path d="M16 3 L16 7" /><path d="M12 9 Q16 4 20 9" /><path d="M9 13 Q16 6 23 13" /><path d="M6 18 Q16 8 26 18" /><path d="M8 18 L8 27 M16 14 L16 27 M24 18 L24 27" /><path d="M4 27 L28 27" /></g></svg>
          <span className="t" style={{ fontSize: 15 }}>Tirtha <b>Atlas</b></span>
        </Link>
        <span style={{ color: "var(--line2)" }}>·</span>
        <Link href="/">Atlas map</Link>
        <Link href="/sites">Gazetteer</Link>
        <Link href="/circuits">Circuits</Link>
        <Link href="/dynasties">Dynasties</Link>
        <Link href="/about">About</Link>
      </nav>
      {children}
      <footer className="footer">
        <p>Tirtha Atlas · prototype v0.1 · Every entry cites its sources; history and legend (katha) are always labelled separately. Maps depict the boundaries of India as per the position of the Government of India / Survey of India.</p>
        <p>Map geometry: Natural Earth (India-worldview edition, public domain). Coordinates cross-checked against Wikipedia/Wikidata (CC0), retrieved 2026-08-26.</p>
      </footer>
    </div>
  );
}
