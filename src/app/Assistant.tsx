"use client";

/**
 * "Ask the Atlas" — the chat surface.
 *
 * Three things here are contract, not decoration:
 *
 *   1. **Citations are always rendered.** Every answer carries the records the
 *      server actually retrieved, with their source links. An answer with no
 *      citations says so explicitly rather than looking like an ordinary reply.
 *      The chips come from the API response, never from the model's text.
 *   2. **A refusal is presented as an answer**, not as an error. It gets the
 *      same bubble, the same weight, and a line explaining that the atlas only
 *      answers from cited records. It is the product working.
 *   3. **`dir="auto"`, not a hardcoded direction.** The question can be typed in
 *      any script and the reply comes back in that script; a fixed `ltr` would
 *      mangle Urdu and Arabic-script answers.
 *
 * NOT mounted anywhere by this file — it is exported for a parent to place.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Source = { l: string; u: string };
type Citation = { id: string; name: string; place: string; sources: Source[] };
type Turn = {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly refused: boolean;
};

const MAX_CHARS = 500;

const OPENER =
  "Ask about any site in the atlas — its history, its dates, its circuits, or how to reach it. Answers come only from cited records; when there is no sourced answer, you will be told so.";

const UNAVAILABLE_TEXT =
  "The assistant is unavailable right now. Every record it draws on is still browsable in the gazetteer.";

let nextId = 0;

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [pending, setPending] = useState(false);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setOpen(false);
    // Return focus where it came from, or a keyboard user is stranded.
    launcherRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Keep the newest turn in view without stealing focus from the input.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, pending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(async () => {
    const asked = question.trim();
    if (!asked || pending) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setTurns((prev) => [...prev, { id: nextId++, role: "user", text: asked, citations: [], refused: false }]);
    setQuestion("");
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question: asked,
          // The reply language is the asker's, and the browser is the only hint
          // available before voice input lands (which measures it properly).
          language: typeof navigator === "undefined" ? undefined : navigator.language,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      const payload = (data ?? {}) as { answer?: string; citations?: Citation[]; refused?: boolean; error?: string };

      const text =
        response.ok && payload.answer
          ? payload.answer
          : payload.error && response.status === 429
            ? payload.error
            : UNAVAILABLE_TEXT;

      setTurns((prev) => [
        ...prev,
        {
          id: nextId++,
          role: "assistant",
          text,
          citations: response.ok ? (payload.citations ?? []) : [],
          refused: Boolean(payload.refused) || !response.ok,
        },
      ]);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      setTurns((prev) => [
        ...prev,
        { id: nextId++, role: "assistant", text: UNAVAILABLE_TEXT, citations: [], refused: true },
      ]);
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }, [question, pending]);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="asstlaunch"
        aria-expanded={open}
        aria-controls="asst-panel"
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">◈</span> Ask the Atlas
      </button>

      {open && (
        <div className="asstscrim" onClick={close} aria-hidden="true" />
      )}

      <section
        id="asst-panel"
        className={`asstpanel${open ? " open" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="asst-title"
        hidden={!open}
      >
        <header className="assthead">
          <div>
            <h2 id="asst-title">Ask the Atlas</h2>
            <p className="asstsub">Answers only from cited records</p>
          </div>
          <button type="button" className="asstclose" onClick={close} aria-label="Close the assistant">
            ×
          </button>
        </header>

        <div className="asstlog" ref={logRef} role="log" aria-live="polite" aria-atomic="false">
          {turns.length === 0 && <p className="asstopener">{OPENER}</p>}

          {turns.map((turn) => (
            <article key={turn.id} className={`asstturn ${turn.role}`}>
              <p className="assttext" dir="auto">{turn.text}</p>

              {turn.role === "assistant" && (
                <div className="asstcites">
                  {turn.citations.length > 0 ? (
                    <>
                      <h3>Sources</h3>
                      <ul>
                        {turn.citations.map((citation) => (
                          <li key={citation.id}>
                            <a href={`/site/${citation.id}`}>{citation.name}</a>
                            <span className="asstwhere"> · {citation.place}</span>
                            <span className="asstsrc">
                              {citation.sources.map((source) => (
                                <a key={source.u} href={source.u} target="_blank" rel="noopener noreferrer">
                                  {source.l}
                                </a>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="asstnocite">
                      No sourced record matched, so there is nothing to cite — and nothing was asserted.
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}

          {pending && (
            <p className="asstpending" role="status">
              Searching the cited records…
            </p>
          )}
        </div>

        <form
          className="asstform"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <label htmlFor="asst-input" className="asstlabel">
            Your question, in any language
          </label>
          <textarea
            id="asst-input"
            ref={inputRef}
            className="asstinput"
            dir="auto"
            rows={2}
            maxLength={MAX_CHARS}
            value={question}
            placeholder="e.g. Which Jyotirlinga is nearest Ujjain?"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
          />
          <div className="asstactions">
            <span className="asstcount" aria-hidden="true">
              {question.length}/{MAX_CHARS}
            </span>
            <button type="submit" className="asstsend" disabled={pending || !question.trim()}>
              {pending ? "Asking…" : "Ask"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
