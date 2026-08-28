import type { Metadata } from "next";
import Link from "next/link";
import { ATLAS_STATS } from "@/lib/generated/atlas-stats";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

/**
 * Served by the service worker when a page is requested that is neither
 * reachable nor cached.
 *
 * Deliberately not "you are offline, try again". The map and every record
 * already read ARE cached, so the reader is not stuck — they are one tap from
 * something that works, and saying so is the only useful thing this page can do.
 */
export default function Offline() {
  return (
    <main className="page">
      <p className="eyebrow">No connection</p>
      <h1>That page has not been saved to this device</h1>
      <p className="ink">
        The atlas works without a connection, but only for what it has already
        loaded. Anything you have opened before is still here.
      </p>
      <div className="actions" style={{ marginTop: 18 }}>
        <Link className="primary" href="/">Open the map</Link>
        <Link href="/sites">The gazetteer</Link>
      </div>
      <p style={{ marginTop: 26, fontSize: 13 }}>
        The map and all {ATLAS_STATS.sites.toLocaleString()} of its marks are
        stored locally, along with every record you have opened. Records you have
        not opened need a connection once — after that they are yours to read on
        a mountain.
      </p>
    </main>
  );
}
