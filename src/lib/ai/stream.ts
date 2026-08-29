/**
 * Streaming an answer without giving up the citation guarantee.
 *
 * THE PROBLEM WITH STREAMING PROSE HERE
 * -------------------------------------
 * `buildAnswer` removes any sentence naming a record no tool returned — that
 * check is what stops a fluent-sounding invention reaching a reader beside
 * cards that contradict it (CLAUDE.md rule 2). It runs on the finished answer.
 *
 * Streaming raw tokens would paint text on screen BEFORE that check has run, so
 * a reader could see an unsupported claim and then watch it vanish. For a
 * reference work, briefly showing a wrong fact is not much better than shipping
 * one — and a retraction is worse, because it happens after they have read it.
 *
 * SO: STREAM SENTENCES, NOT TOKENS
 * --------------------------------
 * Text is buffered until a segment is *complete*, that segment is put through
 * the same `reconcile` rule the finished answer would face, and only what
 * survives is sent. Nothing unverified is ever displayed.
 *
 * The reader still sees the answer build sentence by sentence, and the first
 * one lands in about a second rather than after the whole call. The cost is a
 * sentence of latency instead of a token — which is the right trade for prose
 * nobody reads a third of a word at a time.
 */

import { reconcile } from "./answer.ts";
import { segmentsOf } from "./answer.ts";
import type { AtlasRecord } from "./retrieve.ts";

/** A segment is finished when it ends in terminal punctuation or a newline. */
const TERMINATED = /[.!?।॥…\n][\s"'”’)\]]*$/u;

/**
 * Split a growing buffer into what is safe to vet and what must keep waiting.
 *
 * The trailing fragment is always held back: a half-written sentence cannot be
 * checked for the records it names, because the name may be the next token.
 */
export function takeCompleteSegments(buffer: string): { readonly emit: string; readonly rest: string } {
  const segments = segmentsOf(buffer);
  if (segments.length === 0) return { emit: "", rest: buffer };

  const lastIsComplete = TERMINATED.test(segments[segments.length - 1]!);
  const upTo = lastIsComplete ? segments.length : segments.length - 1;
  if (upTo <= 0) return { emit: "", rest: buffer };

  return { emit: segments.slice(0, upTo).join(""), rest: segments.slice(upTo).join("") };
}

/**
 * The finished answer's rule, applied to one segment.
 *
 * Deliberately `reconcile` rather than a second implementation: two copies of a
 * safety rule drift, and the copy that drifts is the one nobody is watching.
 */
export function vetSegment(
  segment: string,
  cited: readonly AtlasRecord[],
  corpus: readonly AtlasRecord[],
): { readonly text: string; readonly dropped: readonly string[] } {
  const { text, dropped, emptied } = reconcile(segment, cited, corpus);
  return { text: emptied ? "" : text, dropped };
}

// ---------------------------------------------------------------------------
// tool-call deltas
// ---------------------------------------------------------------------------

/** One tool call, assembled. Mirrors `ToolCall` in sarvam.ts. */
export type StreamedToolCall = {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
};

/** Calls in flight, keyed by the stream's own `index`. */
export type ToolCallAccumulator = Readonly<Record<number, StreamedToolCall>>;

/** One frame's worth of tool-call delta, as the completions stream sends it. */
export type ToolCallDelta = {
  readonly index: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
};

/**
 * Fold one frame of deltas into the calls being assembled.
 *
 * A streamed tool call arrives in pieces: the id and name once, then the
 * arguments as a run of JSON fragments that mean nothing until concatenated.
 * `index` is what ties the pieces together when the model opens more than one
 * call at a time — not the id, which only appears on the first frame.
 *
 * Returns a new accumulator; the input is never mutated. The codebase's
 * immutability rule, and a real hazard in a loop that runs per frame.
 */
export function mergeToolCallDeltas(
  acc: ToolCallAccumulator,
  deltas: readonly ToolCallDelta[] | undefined,
): ToolCallAccumulator {
  if (!deltas || deltas.length === 0) return acc;

  return deltas.reduce<ToolCallAccumulator>((next, delta) => {
    const existing = next[delta.index];
    return {
      ...next,
      [delta.index]: {
        id: delta.id ?? existing?.id ?? "",
        type: "function",
        function: {
          name: delta.function?.name ?? existing?.function.name ?? "",
          arguments: (existing?.function.arguments ?? "") + (delta.function?.arguments ?? ""),
        },
      },
    };
  }, acc);
}
