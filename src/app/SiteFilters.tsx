"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SITES, eraOf, fmtYear, type Site } from "@/lib/sites";
import {
  EMPTY_QUERY, FACET_KEYS, facetsOf, filterSites, isActive,
  type FacetCount, type FacetKey, type SearchQuery,
} from "@/lib/search";

/** Long enough to swallow a burst of typing, short enough to feel immediate. */
const DEBOUNCE_MS = 150;

/** Every part of the filter state that survives in the URL. */
const PARAM_KEYS = ["q", ...FACET_KEYS] as const;

const FACET_LABELS: Readonly<Record<FacetKey, { readonly label: string; readonly all: string }>> = {
  deity: { label: "Deity", all: "All deities" },
  tradition: { label: "Tradition", all: "All traditions" },
  country: { label: "Country", all: "All countries" },
  state: { label: "State or region", all: "All states" },
  era: { label: "Era", all: "All eras" },
  circuit: { label: "Circuit", all: "All circuits" },
  tier: { label: "Record depth", all: "All records" },
};

/** Dropdown order, most useful first — not the internal FACET_KEYS order. */
const FACET_ORDER: readonly FacetKey[] = ["deity", "tradition", "era", "country", "state", "circuit", "tier"];

const readQuery = (search: string): SearchQuery => {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of PARAM_KEYS) out[key] = params.get(key) ?? "";
  return out as SearchQuery;
};

/** "?deity=Shiva&state=Tamil+Nadu" — empty parts are dropped so links stay short. */
const toSearch = (query: SearchQuery): string => {
  const params = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
};

type Props = {
  /** How results are laid out: the gazetteer's table, or a grid of cards. */
  readonly layout: "table" | "cards";
  /** Scope the whole panel to one circuit's members. */
  readonly circuit?: string;
  /** Scope the whole panel to one dynasty's sites. */
  readonly dynasty?: string;
  /** Placeholder for the search box; defaults to the general one. */
  readonly placeholder?: string;
};

/**
 * Search + facet filtering over the corpus, shared by every list page.
 *
 * Props are primitives so a server component can render it. The corpus is
 * imported rather than passed: passing ~1,100 records as props would embed them
 * in the RSC payload of all ~240 static list pages, whereas the import lands in
 * one client chunk the browser caches once.
 *
 * The first render is deliberately unfiltered, on the server and on the client,
 * so the static HTML lists everything (crawlable, and usable with no JS). The
 * URL is read in an effect afterwards, which keeps hydration identical.
 */
export default function SiteFilters({ layout, circuit, dynasty, placeholder }: Props) {
  const [query, setQuery] = useState<SearchQuery>(EMPTY_QUERY);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const scoped = useMemo(() => {
    if (circuit) return SITES.filter((s) => (s.circuits ?? []).includes(circuit));
    if (dynasty) return SITES.filter((s) => s.dynasty === dynasty);
    return SITES;
  }, [circuit, dynasty]);

  // Adopt whatever the URL says, on load and on every back/forward.
  useEffect(() => {
    const sync = () => {
      // Drop any keystroke still waiting out its debounce: it belongs to the
      // entry we are navigating away from and would overwrite the restored one.
      if (timer.current) clearTimeout(timer.current);
      const next = readQuery(window.location.search);
      queryRef.current = next;
      setQuery(next);
      setDraft(next.q ?? "");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * `push` adds a history entry; typing replaces instead, so a search does not
   * bury the previous page under one entry per keystroke.
   */
  const commit = useCallback((next: SearchQuery, push: boolean) => {
    // Updated here, not just on render: a debounced keystroke landing between a
    // facet click and its re-render would otherwise build on the stale query
    // and drop the facet.
    queryRef.current = next;
    setQuery(next);
    const url = `${window.location.pathname}${toSearch(next)}`;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  const onSearch = useCallback((value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit({ ...queryRef.current, q: value }, false), DEBOUNCE_MS);
  }, [commit]);

  const onFacet = useCallback((key: FacetKey, value: string) => {
    commit({ ...queryRef.current, [key]: value }, true);
  }, [commit]);

  const clearAll = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setDraft("");
    commit({ ...EMPTY_QUERY }, true);
  }, [commit]);

  const results = useMemo(() => filterSites(scoped, query), [scoped, query]);

  /**
   * Each dropdown counts against the results of every *other* filter, so its
   * numbers say what choosing that value would actually give you — and so
   * narrowing by tradition never empties the country list.
   */
  const facets = useMemo(() => {
    const out = {} as Record<FacetKey, readonly FacetCount[]>;
    for (const key of FACET_KEYS) out[key] = facetsOf(filterSites(scoped, { ...query, [key]: "" }))[key];
    return out;
  }, [scoped, query]);

  // A facet with a single value cannot narrow anything; keep it only if it is the one in use.
  const shown = FACET_ORDER.filter((key) => facets[key].length > 1 || query[key]);
  const active = isActive(query);
  const setCount = FACET_KEYS.filter((key) => query[key]).length;

  return (
    <>
      <div className="filters pagefilters">
        <input
          type="search"
          value={draft}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder ?? "Search names, deities, places, dynasties…"}
          aria-label="Search sites"
          aria-controls={`${panelId}-results`}
        />

        <button
          type="button"
          className={`ftoggle ${open ? "on" : ""}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          Filters{setCount > 0 ? ` · ${setCount}` : ""} {open ? "▴" : "▾"}
        </button>

        <div className={`fwrap ${open ? "open" : ""}`} id={panelId}>
          {shown.map((key) => (
            <select
              key={key}
              aria-label={FACET_LABELS[key].label}
              value={query[key] ?? ""}
              onChange={(e) => onFacet(key, e.target.value)}
            >
              <option value="">{FACET_LABELS[key].all}</option>
              {facets[key].map((f) => (
                <option key={f.value} value={f.value}>{f.value} ({f.count})</option>
              ))}
            </select>
          ))}
        </div>

        {active && <button type="button" className="reset" onClick={clearAll}>clear all</button>}

        <span className="count" role="status" aria-live="polite">
          <b>{results.length}</b> of {scoped.length} site{scoped.length === 1 ? "" : "s"}
        </span>
      </div>

      <div id={`${panelId}-results`}>
        {results.length === 0
          ? <EmptyState onClear={clearAll} />
          : layout === "table" ? <ResultTable sites={results} /> : <ResultCards sites={results} />}
      </div>
    </>
  );
}

function EmptyState({ onClear }: { readonly onClear: () => void }) {
  return (
    <p className="noresults">
      No sites match these filters.{" "}
      <button type="button" className="reset" onClick={onClear}>clear all</button>
    </p>
  );
}

/** The gazetteer's table, still grouped by country — empty countries drop out. */
function ResultTable({ sites }: { readonly sites: readonly Site[] }) {
  const countries = [...new Set(sites.map((s) => s.country))].sort();
  return (
    <>
      {countries.map((country) => {
        const rows = sites.filter((s) => s.country === country).sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section key={country}>
            <h2>{country} · {rows.length}</h2>
            <div className="tablewrap">
              <table className="gz">
                <thead><tr><th>Site</th><th>Place</th><th>Tradition</th><th>Dynasty</th><th>Built</th></tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="dot" style={{ background: `var(--e${eraOf(s) + 1})`, marginRight: 8 }} />
                        <Link href={`/site/${s.id}`}>{s.name}</Link>
                      </td>
                      <td>{s.place}{s.state ? `, ${s.state}` : ""}</td>
                      <td>{s.tradition}</td>
                      <td>{s.dynasty}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtYear(s.built[0])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** The circuit / dynasty card grid. */
function ResultCards({ sites }: { readonly sites: readonly Site[] }) {
  return (
    <div className="cardgrid">
      {sites.map((s) => (
        <Link className="card" href={`/site/${s.id}`} key={s.id}>
          <div className="cn">{s.name}</div>
          <div className="cm">{s.place} · {s.country}</div>
          <div className="cy" style={{ color: `var(--e${eraOf(s) + 1})` }}>{s.builtDisplay}</div>
        </Link>
      ))}
    </div>
  );
}
