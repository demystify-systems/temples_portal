"use client";

/**
 * The two states a filtered list has besides "here are the results" (T-044).
 *
 * Both live in one file because they are one decision: what the results slot
 * shows when it cannot show results. Both are sized from the same box model as
 * the real rows they stand in for, so swapping between them reflows nothing
 * above — the filter panel never moves under the reader's cursor.
 */

/** How many placeholder rows/cards a skeleton draws — a screenful, not a corpus. */
const SKELETON_ROWS = 8;
const SKELETON_CARDS = 6;

export function EmptyState({ total, onClear }: {
  /** How many records were in scope before the filters were applied. */
  readonly total: number;
  readonly onClear: () => void;
}) {
  return (
    <div className="emptystate">
      <p className="eshead">No sites match these filters.</p>
      <p className="esnote">
        Nothing in {total} record{total === 1 ? "" : "s"} answers to every filter at once.
        Widening one of them usually does it — or start again from the whole list.
      </p>
      <button type="button" className="esreset" onClick={onClear}>
        Clear all filters
      </button>
    </div>
  );
}

/**
 * Shown while the client is re-rendering the list — chiefly the first swap on a
 * URL that carries filters, where the static HTML (deliberately unfiltered, so
 * it stays crawlable and works without JS) is about to narrow. A placeholder is
 * honest there; leaving the about-to-be-wrong list on screen is not.
 */
export function ResultsSkeleton({ layout }: { readonly layout: "table" | "cards" }) {
  if (layout === "cards") {
    return (
      <div className="cardgrid" aria-hidden="true">
        {Array.from({ length: SKELETON_CARDS }, (_, i) => (
          <div className="card skelcard" key={i}>
            <span className="skel skel-cn" />
            <span className="skel skel-cm" />
            <span className="skel skel-cy" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="tablewrap" aria-hidden="true">
      <div className="skeltable">
        <div className="skelhead"><span className="skel" /></div>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div className="skelrow" key={i}>
            <span className="skel skel-a" />
            <span className="skel skel-b" />
            <span className="skel skel-c" />
          </div>
        ))}
      </div>
    </div>
  );
}
