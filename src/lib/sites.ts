import rawSites from "../../data/sites.json";
import geo from "../../data/geo.json";

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
  story: string;
  access?: string;
  website?: string;
  phone?: string;
  wiki?: string;
  sources: Source[];
  verified?: string;
};

export const SITES = rawSites as unknown as Site[];
export const GEO = geo as { W: number; H: number; LON0: number; LON1: number; LAT0: number; LAT1: number; svgInner: string };

export const ERAS = [
  { to: 550, name: "Ancient", note: "Maurya · Satavahana · Gupta · Vakataka" },
  { to: 1000, name: "Early medieval", note: "Pallava · Chalukya · Rashtrakuta · Pala · Sailendra" },
  { to: 1350, name: "High medieval", note: "Chola · Chandela · Hoysala · Kakatiya · Khmer · Pagan" },
  { to: 1650, name: "Late medieval", note: "Vijayanagara · Nayaka · Malla · Ayutthaya" },
  { to: 1850, name: "Early modern", note: "Maratha · Sikh · Konbaung · Rattanakosin" },
  { to: 2031, name: "Modern", note: "Colonial to present · revivals & new mandirs" },
] as const;

export const eraIndex = (y: number) => ERAS.findIndex((e) => y < e.to);
export const eraOf = (s: Site) => eraIndex(s.built[0]);
export const appearYear = (s: Site) => (s.origin !== undefined ? s.origin : s.built[0]);
export const fmtYear = (y: number) => (y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`);

export const getSite = (id: string) => SITES.find((s) => s.id === id);

export const slugify = (v: string) =>
  v.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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

export const gmapsUrl = (s: Site) => `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;

export const SITE_NAME = "Tirtha Atlas";
export const SITE_DESC =
  "The sacred geography of the Indic world — temples and sacred sites of India, Nepal, Bhutan, Sri Lanka and Southeast Asia, mapped, dated, storied, and cited.";
