/**
 * Search, synonym expansion and faceting over the corpus.
 *
 * Pure functions only — no React, no data import. Like `site-utils.ts`, this
 * file is a function of its arguments so it can be tested by `node --test`
 * without pulling data/sites.json into the runner. `sites.ts` loads the corpus
 * at module scope, so importing it here would make the whole module untestable.
 *
 * SCOPE (constitution rule 2): this searches fields that already exist on a
 * record. It never adds, infers, or writes data. The synonym and deity-alias
 * tables below are query-side spelling knowledge — they widen what a user can
 * type to reach a record, and never change what the record says.
 */

import { ERAS, eraIndex } from "./site-utils.ts";

/**
 * The minimal shape search needs. `Site` from sites.ts is structurally
 * assignable to it; declaring it here keeps the corpus out of the test runner.
 */
export type Searchable = {
  readonly name: string;
  readonly alt?: string;
  readonly native?: string;
  readonly country: string;
  readonly state?: string;
  readonly place: string;
  readonly tradition: string;
  readonly deity: string;
  readonly dynasty: string;
  readonly style: string;
  readonly circuits?: readonly string[];
  readonly tier?: string;
  /**
   * Optional: the client index defers this column off the critical path, so a
   * record legitimately has no significance until `loadSignificance()` resolves.
   * `haystackOf` treats a missing value as an empty contribution, which means an
   * early search matches on name/place/deity and silently gains full-text depth
   * once the chunk lands.
   */
  readonly significance?: string;
  readonly built: readonly [number, number];
};

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------

/** Combining marks left behind by NFD decomposition (Ś -> S + U+0301). */
const COMBINING_MARKS = /[\u0300-\u036f]/g;
/**
 * Anything that is not a letter, number or combining mark, in any script.
 * Marks are kept: Latin diacritics are already gone by this point, while Indic
 * vowel signs and viramas are load-bearing letters of the `native` field.
 */
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;

/**
 * Fold a string to its comparable form: diacritics removed, lowercased, and
 * punctuation collapsed to single spaces.
 *
 * Letters outside Latin are kept, not stripped, so a Devanagari or Tamil query
 * still reaches the `native` field. `slugify` in site-utils.ts deliberately does
 * the opposite (it must emit URL-safe ASCII) — the two are not interchangeable.
 */
export const normalise = (value: string): string =>
  value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();

/** Normalised, whitespace-separated words. */
export const tokenise = (value: string): string[] =>
  normalise(value).split(" ").filter(Boolean);

// ---------------------------------------------------------------------------
// synonyms — transliteration variants, expanded on the QUERY side
// ---------------------------------------------------------------------------

/**
 * Groups of spellings that mean the same thing in this corpus.
 *
 * Every member of a group expands to every other member. Groups that share a
 * member are merged (temple/kovil and koil/kovil/koyil become one set), so
 * "temple" reaches a record spelled "Koyil".
 *
 * Expansion happens on the query, never on the corpus: the stored text is
 * exactly what its source says.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["sri", "shri", "shree", "sree"],
  ["ishwar", "iswar", "eshwar", "eeswarar", "isvara", "ishvara", "eswarar", "eeswaran", "eswaran", "easwaran"],
  ["swamy", "swami", "svami", "svamy"],
  ["koil", "kovil", "koyil"],
  ["temple", "mandir", "mandira", "kovil", "devalaya", "gudi"],
  ["perumal", "vishnu", "visnu", "narayana", "narayan"],
  ["amman", "ammal", "devi", "mata", "mataji"],
  ["natha", "nath"],
  ["linga", "lingam"],
] as const;

const buildSynonyms = (groups: readonly (readonly string[])[]): Record<string, readonly string[]> => {
  const sets = new Map<string, Set<string>>();
  for (const group of groups) {
    const merged = new Set(group.map(normalise));
    // Fold in every set a member already belongs to, so overlapping groups join.
    for (const term of [...merged]) for (const existing of sets.get(term) ?? []) merged.add(existing);
    for (const term of merged) sets.set(term, merged);
  }
  const out: Record<string, readonly string[]> = {};
  for (const [term, set] of sets) out[term] = [...set].sort();
  return out;
};

/** term -> every spelling it may be written as (including itself). */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = buildSynonyms(SYNONYM_GROUPS);

/** The spellings a single query word should be tried as. */
export const expandToken = (token: string): readonly string[] => SYNONYMS[token] ?? [token];

// ---------------------------------------------------------------------------
// deity aliases
// ---------------------------------------------------------------------------

/**
 * `deity` is free text (995 distinct values over 1122 records) written to match
 * each source, e.g. "Azhagiya Manavalan (Vishnu)" or "Shiva (Brihadisvara)".
 * A marker ending in `*` matches a word by prefix, one starting with `*` by
 * suffix; otherwise the whole word must match. Whole-word matching is
 * deliberate: a substring rule would read "Ramanathaswamy" (Shiva) as Rama.
 */
export const PRINCIPAL_DEITIES: readonly { readonly label: string; readonly markers: readonly string[] }[] = [
  {
    label: "Shiva",
    markers: ["shiva*", "siva*", "sivan", "mahadev*", "nataraj*", "natesa*", "shambhu", "bholenath", "somanath*", "somnath",
      "visvanath*", "vishwanath*", "vishvanath*", "jyotirlinga*", "bhairav*", "kedarnath*", "mallikarjun*", "rudra*",
      "pashupatinath", "pashupati", "amarnath", "trilokinath", "virupaksh*", "*eshwarar", "*eswarar", "*esvara", "*eshvara"],
  },
  {
    label: "Vishnu",
    markers: ["vishnu*", "visnu*", "narayan*", "perumal*", "krishna*", "rama", "ramachandra*", "ranganath*", "ranganayak*",
      "venkateswar*", "venkatesh*", "srinivas*", "balaji", "jagannath*", "narasimh*", "narasingh*", "varaha*", "vamana",
      "govind*", "keshav*", "kesava*", "madhav*", "padmanabh*", "vitthal*", "vithoba", "panduranga*", "badrinath*",
      "dwarkadhish*", "thayar", "hari"],
  },
  {
    label: "Devi / Shakti",
    markers: ["devi*", "amman", "ammal", "amba", "ambal", "ambika*", "durga*", "kali", "kalika*", "bhadrakali", "parvati*",
      "lakshmi*", "laxmi*", "saraswati*", "sarasvati*", "bhagavati*", "bhagawati*", "bhagvati*", "shakti*", "sakti*",
      "mata", "mataji", "chamund*", "bhavani*", "gauri*", "sundari*", "mariamman", "yellamma", "chandi*", "sati",
      "vaishno*", "kamakshi*", "meenakshi*", "minakshi*", "tripura*", "shakambhari", "mahavidya*", "annapurn*",
      "annapoorn*", "*ambigai", "*ambal"],
  },
  {
    label: "Murugan / Kartikeya",
    markers: ["murugan*", "muruga", "kartikey*", "karttikey*", "subramany*", "subrahmany*", "skanda*", "shanmukh*",
      "arumug*", "velayudh*", "kumaraswam*", "senthil*"],
  },
  { label: "Ganesha", markers: ["ganesh*", "ganapat*", "ganpati*", "vinayak*", "vinayag*", "pillayar*", "siddhivinayak*"] },
  { label: "Hanuman", markers: ["hanuman*", "anjaney*", "maruti", "bajrang*"] },
  { label: "Surya", markers: ["surya*", "martand*", "martanda", "biranchi"] },
  {
    label: "Buddha",
    markers: ["buddha*", "buddhist*", "bodhisattva*", "avalokiteshvar*", "avalokitesvar*", "lokeshvar*", "tara",
      "padmasambhav*", "maitreya*", "sakyamuni", "shakyamuni", "vairocana*", "amitabha*", "guanyin", "chaitya*", "vihara*"],
  },
  {
    label: "Mahavira / Tirthankaras",
    markers: ["mahavir*", "tirthankar*", "jain*", "arihant*", "adinath*", "rishabh*", "parshvanath*", "parshwanath*",
      "parsvanath*", "parasnath*", "neminath*", "shantinath*", "sumatinath*", "dharmanath*", "shitalanath*",
      "chandraprabh*", "ajitnath*", "ajitanath*", "sambhavanath*", "abhinandan*", "padmaprabh*", "bahubali*",
      "gommateshwar*", "gomateshwar*"],
  },
  {
    label: "Sikh Gurus",
    markers: ["nanak*", "gobind*", "granth", "sikh*", "khalsa*", "arjan*", "tegh", "takht*", "sahibzade*", "hargobind*"],
  },
] as const;

const wordMatches = (word: string, marker: string): boolean => {
  if (marker.startsWith("*") && marker.endsWith("*")) return word.includes(marker.slice(1, -1));
  if (marker.endsWith("*")) return word.startsWith(marker.slice(0, -1));
  if (marker.startsWith("*")) return word.endsWith(marker.slice(1));
  return word === marker;
};

/**
 * Only ~995 distinct deity strings exist across the corpus, and faceting reads
 * every one of them on every keystroke, so the classification is memoised.
 */
const deityCache = new Map<string, readonly string[]>();

/**
 * Which principal deities a free-text `deity` string names. May be several, or
 * none. The result is shared and frozen — copy it before sorting.
 */
export const principalDeities = (deity: string): readonly string[] => {
  const cached = deityCache.get(deity);
  if (cached) return cached;
  const words = tokenise(deity);
  const found = words.length === 0
    ? []
    : PRINCIPAL_DEITIES.filter((d) => d.markers.some((m) => words.some((w) => wordMatches(w, m)))).map((d) => d.label);
  const frozen = Object.freeze(found);
  deityCache.set(deity, frozen);
  return frozen;
};

const PARENTHETICAL = /\(([^)]+)\)/g;

/**
 * Extra terms a record's deity should also be findable by: whatever is in
 * parentheses ("Azhagiya Manavalan (Vishnu)" -> "Vishnu"), the head before
 * them, and the principal deities named anywhere in the string.
 */
export const deityAliases = (deity: string): string[] => {
  const out = new Set<string>();
  for (const hit of deity.matchAll(PARENTHETICAL)) {
    const inner = hit[1].trim();
    if (inner) out.add(inner);
  }
  const head = deity.split("(")[0].trim();
  if (head) out.add(head);
  for (const label of principalDeities(deity)) out.add(label);
  return [...out];
};

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

/** Records are immutable, so their folded text can be cached by identity. */
const haystacks = new WeakMap<object, string>();

const haystackOf = (site: Searchable): string => {
  const cached = haystacks.get(site);
  if (cached !== undefined) return cached;
  const built = normalise([
    site.name,
    site.alt ?? "",
    site.native ?? "",
    site.deity,
    deityAliases(site.deity).join(" "),
    site.place,
    site.state ?? "",
    site.country,
    site.dynasty,
    site.style,
    (site.circuits ?? []).join(" "),
    site.significance ?? "",
  ].join(" "));
  haystacks.set(site, built);
  return built;
};

/**
 * True when every word of the query — in any of its known spellings — appears
 * somewhere in the record. Words are ANDed so "meenakshi madurai" narrows;
 * spellings within a word are ORed so "shree" reaches "Sri".
 */
export const matches = (site: Searchable, query: string): boolean => {
  const tokens = tokenise(query);
  if (tokens.length === 0) return true;
  const hay = haystackOf(site);
  return tokens.every((token) => expandToken(token).some((variant) => hay.includes(variant)));
};

// ---------------------------------------------------------------------------
// facets
// ---------------------------------------------------------------------------

export const FACET_KEYS = ["tradition", "country", "state", "era", "circuit", "tier", "deity"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export type FacetCount = { readonly value: string; readonly count: number };
export type Facets = Readonly<Record<FacetKey, readonly FacetCount[]>>;

/** Era name of a record, or "" when its start year falls past the last boundary. */
export const eraName = (site: Pick<Searchable, "built">): string => ERAS[eraIndex(site.built[0])]?.name ?? "";

/** Every facet value a record belongs to. Single-valued except circuits and deity. */
const facetValues = (site: Searchable, key: FacetKey): readonly string[] => {
  if (key === "circuit") return site.circuits ?? [];
  if (key === "deity") return principalDeities(site.deity);
  if (key === "era") {
    const name = eraName(site);
    return name ? [name] : [];
  }
  const single = key === "tradition" ? site.tradition
    : key === "country" ? site.country
    : key === "state" ? site.state
    : site.tier;
  return single ? [single] : [];
};

const ERA_ORDER = new Map(ERAS.map((era, i) => [era.name, i] as const));

const rank = (key: FacetKey, a: FacetCount, b: FacetCount): number => {
  // Eras read as a timeline; everything else is most-populous first.
  if (key === "era") return (ERA_ORDER.get(a.value) ?? 0) - (ERA_ORDER.get(b.value) ?? 0);
  return b.count - a.count || a.value.localeCompare(b.value);
};

/**
 * Counts per value for every facet, over exactly the records given.
 *
 * tradition, country, state, era and tier are single-valued, so their counts sum
 * to `sites.length` (minus records with no value). circuit and deity are
 * multi-valued and may sum higher.
 */
export const facetsOf = (sites: readonly Searchable[]): Facets => {
  const tallies = new Map<FacetKey, Map<string, number>>(FACET_KEYS.map((key) => [key, new Map()]));
  for (const site of sites) {
    for (const key of FACET_KEYS) {
      const tally = tallies.get(key)!;
      for (const value of facetValues(site, key)) tally.set(value, (tally.get(value) ?? 0) + 1);
    }
  }
  const out = {} as Record<FacetKey, readonly FacetCount[]>;
  for (const key of FACET_KEYS) {
    out[key] = [...tallies.get(key)!].map(([value, count]) => ({ value, count })).sort((a, b) => rank(key, a, b));
  }
  return out;
};

// ---------------------------------------------------------------------------
// filtering
// ---------------------------------------------------------------------------

export type SearchQuery = Readonly<Partial<Record<FacetKey, string>>> & { readonly q?: string };

/** A query with nothing set — the shared empty value for filter state. */
export const EMPTY_QUERY: SearchQuery = Object.freeze({
  q: "", tradition: "", country: "", state: "", era: "", circuit: "", tier: "", deity: "",
});

/** True when any part of the query would narrow the result set. */
export const isActive = (query: SearchQuery): boolean =>
  Boolean(query.q?.trim()) || FACET_KEYS.some((key) => Boolean(query[key]));

const passesFacets = (site: Searchable, query: SearchQuery): boolean =>
  FACET_KEYS.every((key) => {
    const wanted = query[key];
    return !wanted || facetValues(site, key).includes(wanted);
  });

/** Records matching every set part of the query. Order is preserved. */
export const filterSites = <T extends Searchable>(sites: readonly T[], query: SearchQuery): T[] =>
  sites.filter((site) => passesFacets(site, query) && matches(site, query.q ?? ""));
