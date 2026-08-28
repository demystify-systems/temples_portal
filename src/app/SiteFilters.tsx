"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
// The slim, generated search index — NOT "@/lib/sites". Importing anything from
// that module pulls data/sites.json into the client bundle (309 kB gzipped), and
// this component is what ships it to every list page. eraOf/fmtYear come from
// site-utils, which is deliberately corpus-free, for the same reason.
import { eraOf, fmtYear } from "@/lib/site-utils";
import { SEARCH_INDEX, loadSignificance, type IndexedSite } from "@/lib/search-index";
import {
  EMPTY_QUERY, FACET_KEYS, filterAndFacet, isActive, visibleFacetKeys,
  type FacetKey, type SearchQuery,
} from "@/lib/search";
import { EmptyState, ResultsSkeleton } from "./EmptyState";

/** Long enough to swallow a burst of typing, short enough to feel immediate. */
const DEBOUNCE_MS = 150;

/** Every part of the filter state that survives in the URL. */
const PARAM_KEYS = ["q", ...FACET_KEYS] as const;

const FACET_LABELS: Readonly<Record<FacetKey, { readonly label: string; readonly all: string }>> = {
  deity: { label: "Deity", all: "All deities" },
  group: { label: "Tradition stream", all: "All streams" },
  tradition: { label: "Tradition", all: "All traditions" },
  country: { label: "Country", all: "All countries" },
  state: { label: "State or region", all: "All states" },
  era: { label: "Era", all: "All eras" },
  circuit: { label: "Circuit", all: "All circuits" },
  tier: { label: "Record depth", all: "All records" },
};

/**
 * Dropdown order, most useful first — not the internal FACET_KEYS order.
 *
 * `group` sits directly after `deity`: it is the same question asked coarsely
 * (seven streams rather than several dozen figures), so the reader who finds the
 * deity list too long has the shorter one immediately beside it. Both are ahead
 * of `tradition`, which answers a different question — Shaiva and Shakta are
 * both "Hindu", and the stream is what actually separates them.
 */
const FACET_ORDER: readonly FacetKey[] = ["deity", "group", "tradition", "era", "country", "state", "circuit", "tier"];

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
  /**
   * Scope the whole panel to the records carrying one canonical deity tag.
   * Matched against `deities`, never against the free-text `deity`: the tag is
   * the index, and a record with no tag is correctly out of scope here.
   */
  readonly deity?: string;
  /** Scope the whole panel to one tradition stream (Shaiva, Vaishnava, …). */
  readonly group?: string;
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
export default function SiteFilters({ layout, circuit, dynasty, deity, group, placeholder }: Props) {
  const [query, setQuery] = useState<SearchQuery>(EMPTY_QUERY);
  /**
   * Bumped once the deferred `significance` column arrives. `loadSignificance()`
   * mutates the shared records in place, so React has no way to know the
   * haystacks just got deeper — this is what re-runs the filter against the
   * fuller text. Until then a search matches on name, place, deity and dynasty,
   * which is what the reader sees first anyway.
   */
  const [textReady, setTextReady] = useState(0);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const scoped = useMemo(() => {
    if (circuit) return SEARCH_INDEX.filter((s) => (s.circuits ?? []).includes(circuit));
    if (dynasty) return SEARCH_INDEX.filter((s) => s.dynasty === dynasty);
    if (deity) return SEARCH_INDEX.filter((s) => (s.deities ?? []).includes(deity));
    if (group) return SEARCH_INDEX.filter((s) => s.deityGroup === group);
    return SEARCH_INDEX;
  }, [circuit, dynasty, deity, group]);

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
      // A shared link can arrive with ?q= already set; that is a search too.
      if (next.q?.trim()) requestText();
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

  /**
   * Fetch the full-text column on the first real keystroke, not on page load.
   * It is 208.7 kB gzipped of the index's 342 kB at 2,271 records, and nothing
   * reads it until someone searches — so a visitor who only browses or filters
   * by facet never pays for it at all.
   */
  const textRequested = useRef(false);
  const requestText = useCallback(() => {
    if (textRequested.current) return;
    textRequested.current = true;
    loadSignificance().then(() => setTextReady((n) => n + 1)).catch(() => {
      // Full-text depth is an enhancement; the other fields still search.
      textRequested.current = false;
    });
  }, []);

  const onSearch = useCallback((value: string) => {
    if (value.trim()) requestText();
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

  /**
   * Results AND every dropdown's counts, from ONE traversal of the corpus.
   *
   * This used to be two memos and nine passes: one `filterSites` for the list,
   * then one more per facet key, because each dropdown counts against the
   * results of every OTHER filter — so choosing a deity does not collapse the
   * country list. That semantic is unchanged and still tested; `filterAndFacet`
   * just gets it in a single pass. Measured on the full 2,796-record corpus it
   * took a keystroke from ~21 ms to ~2 ms here, which is the difference between
   * ~150 ms and ~15 ms on the low-end Android this atlas is actually read on.
   *
   * `textReady` is a deliberate dependency, not a stray one: loadSignificance()
   * mutates the shared records in place, so `scoped` and `query` are
   * referentially unchanged even though the searchable text just grew. The
   * facet counts are now recomputed with it too, which they always should have
   * been — a count taken before the full text arrived was a count of less.
   */
  const view = useMemo(
    () => filterAndFacet(scoped, query),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, query, textReady],
  );
  const results = view.results;

  /**
   * The count above is always live; the list below may lag by a beat.
   *
   * Filtering is cheap — rendering up to 1,126 rows is not, and the first render
   * after mount does exactly that whenever the URL arrives with filters on it
   * (the static HTML is deliberately unfiltered). Deferring only the *rendered*
   * array lets React keep the controls responsive and tells us, in `isStale`,
   * precisely when a placeholder is owed. On the first render, server and client
   * both see the same array instance, so hydration is untouched.
   */
  const shownResults = useDeferredValue(results);
  const isStale = shownResults !== results;

  const facets = view.facets;

  // A facet with a single value cannot narrow anything; keep it only if it is
  // the one in use. This is what hides the Deity and Tradition-stream dropdowns
  // outright on a corpus whose records carry no tags, rather than offering two
  // empty selects. The rule is `visibleFacetKeys` in search.ts so it can be
  // tested without mounting this component.
  const shown = visibleFacetKeys(FACET_ORDER, facets, query);
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

      <div id={`${panelId}-results`} aria-busy={isStale}>
        {results.length === 0
          ? <EmptyState total={scoped.length} onClear={clearAll} />
          : isStale
            ? <ResultsSkeleton layout={layout} />
            : layout === "table" ? <ResultTable sites={shownResults} /> : <ResultCards sites={shownResults} />}
      </div>
    </>
  );
}

/** The gazetteer's table, still grouped by country — empty countries drop out. */
function ResultTable({ sites }: { readonly sites: readonly IndexedSite[] }) {
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
                <thead><tr><th>IndexedSite</th><th>Place</th><th>Tradition</th><th>Dynasty</th><th>Built</th></tr></thead>
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

/**
 * The canonical tags a card shows, or nothing at all.
 *
 * Returns null — not an empty list, not a dash, not "Deity: —" — when a record
 * carries no tag. Roughly one record in sixteen has a dedication that names no
 * figure (a relic stupa, a monastic university, a river confluence), and for
 * those the honest rendering is silence. A placeholder would read as missing
 * data about a deity, when in fact there is no deity to be missing.
 *
 * The free-text `deity` is deliberately NOT the fallback here: it is prose, it
 * is already the headline of the record's own page, and a card is not where it
 * belongs. These chips are the facet vocabulary made visible — click-sized,
 * consistent, and the same words the Deity dropdown offers.
 */
function DeityChips({ site }: { readonly site: IndexedSite }) {
  const tags = site.deities ?? [];
  if (tags.length === 0) return null;
  return (
    <div className="cdeity">
      {tags.map((tag) => <span className="chip chip-deity" key={tag}>{tag}</span>)}
    </div>
  );
}

/** The circuit / dynasty / deity card grid. */
function ResultCards({ sites }: { readonly sites: readonly IndexedSite[] }) {
  return (
    <div className="cardgrid">
      {sites.map((s) => (
        <Link className="card" href={`/site/${s.id}`} key={s.id}>
          <div className="cn">{s.name}</div>
          <div className="cm">{s.place} · {s.country}</div>
          <DeityChips site={s} />
          <div className="cy" style={{ color: `var(--e${eraOf(s) + 1})` }}>{s.builtDisplay}</div>
        </Link>
      ))}
    </div>
  );
}
