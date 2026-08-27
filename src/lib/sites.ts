import rawSites from "../../data/sites.json";
import geo from "../../data/geo.json";
import { ERAS, eraIndex, eraOf, appearYear, fmtYear, slugify, gmapsUrl } from "./site-utils";

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
  deity: string;
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
