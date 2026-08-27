import SiteHeader from "./SiteHeader";
import { headerStats } from "@/lib/sites";

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader stats={headerStats()} />
      <div className="page">
        {children}
        <footer className="footer">
          <p>Tirtha Atlas · prototype v0.1 · Every entry cites its sources; history and legend (katha) are always labelled separately. Maps depict the boundaries of India as per the position of the Government of India / Survey of India.</p>
          <p>Map geometry: Natural Earth (India-worldview edition, public domain). Coordinates cross-checked against Wikipedia/Wikidata (CC0), retrieved 2026-08-26.</p>
        </footer>
      </div>
    </>
  );
}
