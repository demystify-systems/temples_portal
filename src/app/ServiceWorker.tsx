"use client";

import { useEffect } from "react";

/**
 * Registers the service worker. Renders nothing.
 *
 * A component rather than an inline script so it is subject to the same CSP as
 * everything else — `next.config.mjs` has a CSP pending an inline-style audit,
 * and adding a new inline script now would be one more thing that audit has to
 * unpick.
 *
 * Registration is deferred to `load`. The worker's install step fetches the
 * whole shell, and doing that while the page is still fetching its own critical
 * assets makes the FIRST visit slower to serve every visit after it — the wrong
 * trade on a connection bad enough to need offline support in the first place.
 *
 * Failure is silent by design. A browser with no service-worker support, a
 * private window, or a user who has blocked storage all end up here, and the
 * atlas works perfectly without any of this. An error banner would report a
 * degradation the reader cannot act on and will not notice.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
