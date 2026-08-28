import rawSites from "../../data/sites.json";
import geo from "../../data/geo.json";
import { ERAS, eraIndex, eraOf, appearYear, fmtYear, slugify, gmapsUrl } from "./site-utils";
import { groupByValues } from "./search";

// Pure helpers live in site-utils.ts so they are testable without loading the
// corpus; re-exported here so every existing import keeps working.
export { ERAS, eraIndex, eraOf, appearYear, fmtYear, slugify, gmapsUrl };

export type Source = { l: string; u: string };
export type DisputedCircuit = {
  circuit: string;
  status: "disputed" | "unsourced";
  note: string;
  source?: string;
};
export type Site = {
  id: string;
  name: string;
  alt?: string;
  native?: string;
  country: string;
  state?: string;
  place: string;
  lat: number;
  lng: number;
  tradition: "Hindu" | "Buddhist" | "Jain" | "Sikh";
  /**
   * Free text, exactly as sourced — "Meenakshi (Parvati) & Sundareswarar
   * (Shiva)", "Devi Bargabhima (Kapalini / Bhimarupa), a form of Kali". It
   * carries the epithet, the consort and the local name, and it is what a record
   * page SHOWS. `deities` below is the filter index beside it, never a
   * replacement: the tag flattens away the very detail this field exists to keep.
   */
  deity: string;
  /**
   * GENERATED. Canonical deity tags, written onto the corpus by
   * scripts/build-deity-tags.mjs from data/vocab/deity.json. Never hand-edited.
   *
   * Multi-valued — a temple to a divine couple carries both — and legitimately
   * ABSENT: a dedication that names no figure (a relic stupa, a monastic
   * university, "Parabrahma, worshipped without image", a river confluence) gets
   * no tag rather than a guessed one, per constitution rule 2. An untagged record
   * renders no deity chip and counts toward no deity facet. There is no "unknown"
   * bucket and no placeholder — the absence is the honest answer.
   */
  deities?: string[];
  /** GENERATED. The stream the tags roll up to: Shaiva, Vaishnava, Shakta, Smarta, Jain, Buddhist, Sikh. */
  deityGroup?: string;
  built: [number, number];
  builtDisplay: string;
  origin?: number;
  originNote?: string;
  dynasty: string;
  patron?: string;
  style: string;
  circuits?: string[];
  /**
   * Contested membership claims, held ALONGSIDE `circuits` rather than inside it.
   * A record both claims the circuit and flags the claim: rival claimants contest
   * a slot, so both sides carry an entry (Baidyanath Deoghar and Vaijnath Parli
   * dispute one Jyotirlinga between them). Keeping `circuits` a plain string[]
   * preserves allCircuits(), slug routing, the facet filter and the Supabase
   * text[] column. Framing must stay dated, cited and neutral (guardrail G10).
   */
  disputedCircuits?: DisputedCircuit[];
  status?: string[];
  significance: string;
  story?: string;
  tier?: string;
  access?: string;
  website?: string;
  phone?: string;
  wiki?: string;
  sources: Source[];
  verified?: string;
};

export const SITES = rawSites as unknown as Site[];
export const GEO = geo as { W: number; H: number; LON0: number; LON1: number; LAT0: number; LAT1: number; svgInner: string };


export const getSite = (id: string) => SITES.find((s) => s.id === id);


export const allDynasties = () => {
  const m = new Map<string, Site[]>();
  for (const s of SITES) {
    const k = s.dynasty;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(s);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

export const allCircuits = () => {
  const m = new Map<string, Site[]>();
  for (const s of SITES) for (const c of s.circuits ?? []) {
    if (!m.has(c)) m.set(c, []);
    m.get(c)!.push(s);
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};

/**
 * Every canonical deity tag in use, with the records carrying it.
 *
 * DERIVED FROM THE DATA, never a hard-coded list. The vocabulary grows with
 * every data wave, and both the tag set and the counts have moved several times
 * in a single day — so anything that enumerates deities must read the corpus at
 * build time, or it silently stops offering the newest tags. No count is written
 * down anywhere in this file for the same reason.
 *
 * Multi-valued, like `allCircuits`: a record tagged ["Parvati", "Shiva"] appears
 * under both, so the group sizes sum higher than SITES.length. Records with no
 * tag appear under nothing at all — that is the point, not an oversight.
 *
 * Ordered by size, then name: the largest tag is the entry nearly everyone wants
 * first, and the name tiebreak keeps the order stable across rebuilds so slugs
 * and sitemap entries do not shuffle when two tags draw level.
 */
export const allDeities = () => groupByValues(SITES, (s) => s.deities ?? []);

/**
 * Every tradition stream in use, with its records. Single-valued per record, so
 * these counts sum to the number of TAGGED records — short of SITES.length by
 * exactly the untagged ones, which is expected and must not be papered over.
 */
export const allDeityGroups = () => groupByValues(SITES, (s) => (s.deityGroup ? [s.deityGroup] : []));


export const SITE_NAME = "Tirtha Atlas";
export const SITE_DESC =
  "The sacred geography of the Indic world — temples and sacred sites of India, Nepal, Bhutan, Sri Lanka and Southeast Asia, mapped, dated, storied, and cited.";

/** Coverage figures shown in the shared site header. */
export const headerStats = () => ({
  sites: SITES.length,
  countries: new Set(SITES.map((s) => s.country)).size,
  traditions: new Set(SITES.map((s) => s.tradition)).size,
  centuries: Math.round((2030 - Math.min(...SITES.map((s) => s.built[0]))) / 100),
});
