"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The render-error boundary.
 *
 * Must be a client component — that is Next's contract for `error.tsx`, and it
 * is why this one cannot render `SiteHeader` with live stats the way
 * `not-found.tsx` does: pulling the corpus in here would put it back in a client
 * bundle, which is the exact bug the atlas page was just fixed for.
 *
 * The copy says what happened and what to do, and does not apologise twice. It
 * also does not show `error.message`: a server-side render error can carry a
 * file path, a query fragment or an upstream API response, and none of that is
 * the reader's problem or safe to publish.
 */
export default function Error({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // Server-side only in production, where the digest is the handle that ties
    // this page to the real stack trace in the platform log.
    console.error("[render error]", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="page">
      <p className="eyebrow">Something broke</p>
      <h1>This page did not finish loading</h1>
      <p className="ink">
        The fault is ours, not the link&rsquo;s. Nothing about the record has
        changed, and the rest of the atlas is unaffected.
      </p>
      <div className="actions" style={{ marginTop: 18 }}>
        <button className="primary" onClick={reset}>Try again</button>
        <Link href="/sites">Search the gazetteer</Link>
        <Link href="/">Open the map</Link>
      </div>
      {error.digest && (
        <p className="mono" style={{ fontSize: 11, color: "var(--mut)", marginTop: 22 }}>
          reference {error.digest} — quote this if you report it
        </p>
      )}
    </main>
  );
}
