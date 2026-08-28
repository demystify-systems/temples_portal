import { DEFAULT_SITE_URL } from "./src/lib/site-url.mjs";

const CANONICAL_HOST = new URL(DEFAULT_SITE_URL).host; // tirthaatlas.org

/**
 * Every host except the canonical one redirects to it.
 *
 * Without this, tirthaatlas.org, www.tirthaatlas.org, tirthaatlas.com and
 * www.tirthaatlas.com all served identical 200s — four origins of duplicate
 * content, with search engines free to pick whichever they liked and split link
 * authority across the rest. The `<link rel="canonical">` in layout.tsx states
 * the preference; these redirects enforce it.
 *
 * Permanent (308, method-preserving) rather than temporary: this is not a trial.
 */
const ALIAS_HOSTS = ["www.tirthaatlas.org", "tirthaatlas.com", "www.tirthaatlas.com"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return ALIAS_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: `https://${CANONICAL_HOST}/:path*`,
      permanent: true,
    }));
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // A public read-only corpus: these are the cheap wins that cannot
          // break it. No CSP yet — that needs the map's inline styles audited.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // `microphone=(self)` — not `()` — because "Ask the Atlas" now records a
          // spoken question. `()` denies the API to this origin as well, so
          // getUserMedia rejects before a permission prompt can appear and the
          // talk button is dead with nothing in the client to diagnose it by.
          // Every other origin is still denied, and the camera stays fully shut.
          { key: "Permissions-Policy", value: "geolocation=(self), microphone=(self), camera=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
