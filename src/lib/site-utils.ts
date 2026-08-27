/**
 * Pure helpers, deliberately free of any data import.
 *
 * `sites.ts` loads data/sites.json at module scope, which makes everything in it
 * untestable without pulling 941 records into the test runner (and unimportable
 * by plain Node, which requires an import attribute for JSON that tsc does not).
 * Everything here is a function of its arguments only, so it can be tested
 * directly — see site-utils.test.ts.
 */

export type Era = { readonly to: number; readonly name: string; readonly note: string };

/** Era boundaries are upper-exclusive: a year belongs to the first era it precedes. */
export const ERAS: readonly Era[] = [
  { to: 550, name: "Ancient", note: "Maurya · Satavahana · Gupta · Vakataka" },
  { to: 1000, name: "Early medieval", note: "Pallava · Chalukya · Rashtrakuta · Pala · Sailendra" },
  { to: 1350, name: "High medieval", note: "Chola · Chandela · Hoysala · Kakatiya · Khmer · Pagan" },
  { to: 1650, name: "Late medieval", note: "Vijayanagara · Nayaka · Malla · Ayutthaya" },
  { to: 1850, name: "Early modern", note: "Maratha · Sikh · Konbaung · Rattanakosin" },
  { to: 2031, name: "Modern", note: "Colonial to present · revivals & new mandirs" },
] as const;

/** Index into ERAS for a year, or -1 when the year falls past the last boundary. */
export const eraIndex = (year: number): number => ERAS.findIndex((e) => year < e.to);

/** Minimal shape the era/timeline helpers need — not the full Site record. */
export type Dated = { built: readonly [number, number]; origin?: number };

export const eraOf = (s: Dated): number => eraIndex(s.built[0]);

/**
 * The year a site should appear on the timeline. `origin` wins when present: a
 * site whose current structure is 17th-century may be attested far earlier, and
 * the scrubber should show it from the earlier date.
 */
export const appearYear = (s: Dated): number => (s.origin !== undefined ? s.origin : s.built[0]);

export const fmtYear = (year: number): string =>
  year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;

/** URL-safe slug. Ampersands become "and" so "Shiva & Parvati" keeps its sense. */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Google Maps link built from coordinates only — no Places data is stored (G5). */
export const gmapsUrl = (s: { lat: number; lng: number }): string =>
  `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;
