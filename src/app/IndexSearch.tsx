"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
// `normalise` only — the same diacritic folding the site search uses, so
// "Sailendra" reaches "Śailendra" on an index page exactly as it does in the
// gazetteer. Writing a second folding here would be a second set of rules to
// keep in step; search.ts owns that knowledge.
import { normalise } from "@/lib/search";

/** Long enough to swallow a burst of typing, short enough to feel immediate. */
const DEBOUNCE_MS = 150;

/** One entry in an index: a group of records, already rendered by the page. */
export type IndexItem = {
  readonly key: string;
  /** The name the reader is looking for — always matched. */
  readonly label: string;
  /**
   * Extra text to match on. By convention this is exactly the other text the
   * page prints on this item's card (its countries, traditions, dates), so a
   * hit is always visible on screen: nobody has to wonder why "Cambodia"
   * returned "Khmer" when the card says Cambodia.
   */
  readonly keywords?: string;
  /** The card, row or list item itself — rendered on the server, filtered here. */
  readonly node: ReactNode;
};

/** A titled block of items. Most pages have one; /patrons has two. */
export type IndexGroup = {
  readonly id: string;
  readonly heading?: string;
  /**
   * Prose under the heading. Shown ONLY while the filter is inactive: this copy
   * counts and characterises the whole group ("N further patrons appear once
   * each"), so it would be a false statement about a filtered subset.
   */
  readonly note?: ReactNode;
  /** The existing layout class for this block: "cardgrid", "patronlist", … */
  readonly listClass?: string;
  /** `ul` when the page's items are `<li>`s. Defaults to a `div`. */
  readonly tag?: "div" | "ul";
  readonly items: readonly IndexItem[];
};

type Props = {
  readonly groups: readonly IndexGroup[];
  /** What is being searched, for the input's accessible name: "dynasties". */
  readonly label: string;
  /** [singular, plural] for the live count and the empty state: ["circuit", "circuits"]. */
  readonly noun: readonly [string, string];
  readonly placeholder?: string;
  /** URL parameter to keep the term in. Defaults to `q`, as everywhere else. */
  readonly param?: string;
};

/**
 * A search box for an INDEX page — the pages that list groups (dynasties,
 * circuits, patrons) rather than records. There are hundreds of dynasties and
 * patrons and no way to reach one without this.
 *
 * Deliberately not `SiteFilters`: that one owns the corpus, its facets and its
 * deferred full-text chunk, and none of that exists here. What it does share is
 * the interaction vocabulary — the same 150 ms debounce, the same URL round
 * trip, the same `.filters.pagefilters` shell, the same `.count` live region,
 * the same `.reset` affordance, the same `.emptystate` — so the two read as one
 * control, because to the reader they are.
 *
 * The items are rendered by the (server) page and passed through as nodes: the
 * filter never needs to know what a dynasty card looks like, and no page has to
 * ship its data to the browser to be searchable.
 *
 * The first render is deliberately unfiltered on server and client alike, so the
 * static HTML lists every entry — crawlable, and complete with no JS. The URL is
 * read in an effect afterwards, which keeps hydration identical.
 */
export default function IndexSearch({ groups, label, noun, placeholder, param = "q" }: Props) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const resultsId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Adopt whatever the URL says, on load and on every back/forward.
  useEffect(() => {
    const sync = () => {
      // Drop any keystroke still waiting out its debounce: it belongs to the
      // entry we are navigating away from and would overwrite the restored one.
      if (timer.current) clearTimeout(timer.current);
      const next = new URLSearchParams(window.location.search).get(param) ?? "";
      setQuery(next);
      setDraft(next);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [param]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * `push` adds a history entry; typing replaces instead, so a search does not
   * bury the previous page under one entry per keystroke. Parameters this
   * component does not own are carried through untouched.
   */
  const commit = useCallback((next: string, push: boolean) => {
    setQuery(next);
    const params = new URLSearchParams(window.location.search);
    if (next.trim()) params.set(param, next.trim());
    else params.delete(param);
    const encoded = params.toString();
    const url = `${window.location.pathname}${encoded ? `?${encoded}` : ""}`;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [param]);

  const onSearch = useCallback((value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(value, false), DEBOUNCE_MS);
  }, [commit]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setDraft("");
    commit("", true);
    inputRef.current?.focus();
  }, [commit]);

  /**
   * Folded once per item, not once per keystroke: `normalise` walks the string
   * three times, and /dynasties alone has hundreds of items.
   */
  const haystacks = useMemo(
    () => groups.map((group) => group.items.map((item) => normalise(`${item.label} ${item.keywords ?? ""}`))),
    [groups],
  );

  const tokens = useMemo(() => normalise(query).split(" ").filter(Boolean), [query]);

  /** Every token must appear somewhere, so a second word narrows rather than widens. */
  const shown = useMemo(
    () => groups.map((group, g) => group.items.filter((_, i) => tokens.every((t) => haystacks[g][i].includes(t)))),
    [groups, haystacks, tokens],
  );

  const total = groups.reduce((n, group) => n + group.items.length, 0);
  const count = shown.reduce((n, items) => n + items.length, 0);
  const active = tokens.length > 0;
  const [one, many] = noun;

  return (
    <>
      <div className="filters pagefilters idxfilters">
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && draft) { e.preventDefault(); clear(); } }}
          placeholder={placeholder ?? `Search ${many}…`}
          aria-label={`Search ${label}`}
          aria-controls={resultsId}
        />

        {/* Keyed to the box's own contents, not to the committed query, so it
            appears with the first keystroke rather than 150 ms after it. */}
        {draft !== "" && <button type="button" className="reset" onClick={clear}>clear</button>}

        <span className="count" role="status" aria-live="polite">
          <b>{count}</b> of {total} {total === 1 ? one : many}
        </span>
      </div>

      <div id={resultsId}>
        {count === 0 && active ? (
          <div className="emptystate">
            <p className="eshead">No {many} match “{query.trim()}”.</p>
            <p className="esnote">
              Nothing among {total} {total === 1 ? one : many} answers to that. A shorter word usually
              does it — or start again from the whole list.
            </p>
            <button type="button" className="esreset" onClick={clear}>
              Show all {total} {total === 1 ? one : many}
            </button>
          </div>
        ) : (
          groups.map((group, g) => {
            const items = shown[g];
            // A heading over nothing is noise; the live count above already says
            // the total, and an empty block would read as a claim of absence.
            if (items.length === 0) return null;
            const List = group.tag === "ul" ? "ul" : "div";
            return (
              <section key={group.id}>
                {group.heading && (
                  <h2>
                    {group.heading}
                    <span className="idxn">{items.length}</span>
                  </h2>
                )}
                {!active && group.note}
                <List className={group.listClass}>
                  {items.map((item) => <Fragment key={item.key}>{item.node}</Fragment>)}
                </List>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
