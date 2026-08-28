"use client";

/**
 * The matched records, under the answer, as cards that open the atlas.
 *
 * A prose answer with no way through to the record is a dead end: the reader is
 * told a temple exists and left to go and find it. These cards make the answer
 * a doorway.
 *
 * Three things here are contract, not decoration:
 *
 *   1. **Every href comes from the payload**, which the server built from the
 *      records the tools actually returned (`src/lib/ai/answer.ts`). Nothing on
 *      this card is parsed out of the model's text. A link derived from
 *      generated prose can point at a record that was never retrieved — a
 *      fabricated citation that also navigates.
 *   2. **A contested membership stays contested.** The chip carries the circuit
 *      AND the disagreement, exactly as `/site/[slug]` renders it (G10). An
 *      answer must not settle, by omission, a dispute the atlas leaves open.
 *   3. **"and N more" is honest arithmetic**, not a flourish: it is the count of
 *      cited records the cap hid, and it leads to the gazetteer where they all
 *      are. A refusal has no cards at all, so this component renders nothing.
 *
 * The visual language is the site's existing `.card` / `.cardgrid`; the only new
 * CSS is the layout needed because the panel is not a `.page`.
 *
 * NOT mounted by this file — it is exported for `Assistant.tsx` to place under
 * the answer text, above the source chips.
 */

import Link from "next/link";
import type { AnswerResult, MoreLink } from "@/lib/ai/answer";

export type AssistantResultsProps = {
  readonly results: readonly AnswerResult[];
  readonly more?: MoreLink | null;
};

/** The dispute in three words, matching the wording on the site page. */
const disputeLabel = (status?: string): string =>
  status === "unsourced" ? "no source located" : "disputed";

export default function AssistantResults({ results, more }: AssistantResultsProps) {
  // A refusal cites nothing, so it links to nothing. Rendering an empty heading
  // would suggest the answer had records behind it when it did not.
  if (results.length === 0) return null;

  return (
    <section className="asstresults" aria-label="Records this answer draws on">
      <h3>In the atlas</h3>

      <ul className="cardgrid">
        {results.map((result) => (
          <li className="card" key={result.id}>
            {/* The name is the card's link. Its ::after covers the card, so the
                whole tile is clickable while the tab stop stays a single, real
                anchor with a readable accessible name. */}
            <Link className="cn" href={result.url}>
              {result.name}
            </Link>
            {result.native && (
              <div className="asstrnative" dir="auto">
                {result.native}
              </div>
            )}
            <div className="cm">
              {[result.place, result.state, result.country].filter(Boolean).join(" · ")}
            </div>
            <div className="cy">
              {result.builtDisplay} · {result.tradition}
            </div>

            {(result.circuits.length > 0 || result.dynasty) && (
              <div className="asstrdeep">
                {result.circuits.map((circuit) => (
                  <Link
                    key={circuit.url}
                    className={`chip${circuit.contested ? " chip-disputed" : ""}`}
                    href={circuit.url}
                    title={circuit.note}
                  >
                    {circuit.name}
                    {circuit.contested && <em>{disputeLabel(circuit.status)}</em>}
                  </Link>
                ))}
                {result.dynasty && (
                  <Link className="chip" href={result.dynasty.url}>
                    {result.dynasty.name}
                  </Link>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {more && more.count > 0 && (
        <p className="asstrmore">
          <Link href={more.url}>and {more.count} more in the gazetteer →</Link>
        </p>
      )}
    </section>
  );
}
