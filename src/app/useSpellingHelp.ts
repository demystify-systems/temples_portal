"use client";

/**
 * "Did you mean" — the database's answer when the local index has none.
 *
 * The atlas filters its bundled index by substring, which is fast, works
 * offline, and cannot find a temple you have spelled a different way. There is
 * no single correct romanisation of these names: Brihadisvara, Brihadeeswarar
 * and Bṛhadīśvara are one temple, and a substring match answers "no sites match
 * these filters" for two of the three. The reader is then told, in effect, that
 * the atlas has no record of a temple it has a flagship record for.
 *
 * So this asks Postgres — but ONLY when the local index has already failed.
 * That ordering is the whole design:
 *
 *   - the common case costs nothing. A query that matches locally never touches
 *     the network, so typing stays instant and the database sees a request per
 *     FAILED search rather than per keystroke;
 *   - it degrades to silence. No database, no network, offline, rate-limited —
 *     every one of those ends with no suggestions, which is exactly the state
 *     the page was in before this existed (constitution rule 6);
 *   - it never overrides. These are offered as suggestions beside the empty
 *     state, not merged into the result list, because a 0.35-similarity guess
 *     must not be presented as a match.
 */

import { useEffect, useState } from "react";

export type Suggestion = {
  readonly id: string;
  readonly name: string;
  readonly place: string;
  readonly country: string;
  readonly match: "exact" | "alias" | "fuzzy";
};

/** Below this a query is a prefix someone is still typing, not a misspelling. */
const MIN_QUERY = 3;
/** Long enough that a pause reads as "finished typing", not as lag. */
const DEBOUNCE_MS = 350;

export function useSpellingHelp(query: string, localHits: number): readonly Suggestion[] {
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);

  useEffect(() => {
    const q = query.trim();
    // The local index answered. Asking anything else would be spending a request
    // to confirm what the reader is already looking at.
    if (localHits > 0 || q.length < MIN_QUERY) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}&limit=6`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { hits?: Suggestion[] } | null) => {
          setSuggestions(data?.hits ?? []);
        })
        // Offline, no database, rate-limited, aborted — all the same outcome:
        // no suggestions, which is where the page was before this existed.
        .catch(() => setSuggestions([]));
    }, DEBOUNCE_MS);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, localHits]);

  return suggestions;
}
