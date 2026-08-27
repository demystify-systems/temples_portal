import rawSites from "../../data/sites.json";
import geo from "../../data/geo.json";
import { ERAS, eraIndex, eraOf, appearYear, fmtYear, slugify, gmapsUrl } from "./site-utils";

// Pure helpers live in site-utils.ts so they are testable without loading the
// corpus; re-exported here so every existing import keeps working.
export { ERAS, eraIndex, eraOf, appearYear, fmtYear, slugify, gmapsUrl };

export type Source = { l: string; u: string };
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
