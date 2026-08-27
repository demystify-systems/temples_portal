/**
 * Canonical origin for metadata, sitemap and robots.
 *
 * The failure this prevents: NEXT_PUBLIC_SITE_URL is set per-environment, so a
 * preview deploy, a stale value, or a plain empty string can quietly emit
 * canonical URLs and sitemap entries pointing at a host we do not own or have
 * retired. Search engines then index the wrong origin, and undoing that costs
 * far more than the check.
 *
 * So the env var is treated as a *suggestion*: anything that is not plausibly a
 * public canonical host falls back to DEFAULT_SITE_URL.
 */

export const DEFAULT_SITE_URL = "https://tirthaatlas.org";

/**
 * Hosts that must never appear in a canonical URL.
 *
 * Matched against `URL.hostname`, deliberately NOT `URL.host`: `host` carries the
 * port, so "localhost:3000" would fail an equality check against "localhost" and
 * a dev origin would leak into production canonicals.
 */
const isNonCanonicalHost = (hostname) => {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "vercel.app" || h.endsWith(".vercel.app")) return true;
  if (h.startsWith("127.")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  // Bare IPv4 (any address, not just loopback) and bracketed IPv6 literals.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.startsWith("[") && h.endsWith("]")) return true;
  return false;
};

/**
 * Normalise a candidate origin, or fall back to DEFAULT_SITE_URL.
 *
 * Falls back when the value is empty, unparseable, not http(s), or resolves to a
 * preview/loopback host. Trailing slashes are trimmed so callers can safely
 * concatenate paths.
 *
 * @param {string | undefined | null} raw
 * @returns {string} an origin with no trailing slash
 */
export function canonicalSiteUrl(raw) {
  if (typeof raw !== "string") return DEFAULT_SITE_URL;

  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_SITE_URL;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return DEFAULT_SITE_URL;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_SITE_URL;
  if (isNonCanonicalHost(url.hostname)) return DEFAULT_SITE_URL;

  // Keep any explicit path prefix (a site served under a sub-path), minus
  // trailing slashes, so `${SITE_URL}/sitemap.xml` never doubles the separator.
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export const SITE_URL = canonicalSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
