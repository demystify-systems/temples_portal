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
 *   4. **A spoken question lands in the input box, not in a request.** The
 *      transcript is shown for the user to read and correct before anything is
 *      asked, and the language it was *detected* in — a measured value from the
 *      speech API, not `navigator.language` — is what the reply is generated and
 *      read back in.
 *
 * NOT mounted anywhere by this file — it is exported for a parent to place.
 * `layout.tsx` mounts it only when `SARVAM_API_KEY` is set, which is also why
 * the voice controls inside it need no key check of their own: no key, no
 * assistant, no microphone button.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import VoiceButton, { SpeakButton, type VoiceTranscript } from "./VoiceButton";
import dynamic from "next/dynamic";

/**
 * The call surface, loaded only when someone actually asks to speak.
 *
 * It pulls in an AudioContext, a MediaRecorder and the VAD loop, none of which
 * a person who types their question will ever run. `ssr: false` because every
 * one of those APIs is browser-only.
 */
const CallPanel = dynamic(() => import("./CallPanel"), {
  ssr: false,
  loading: () => <p className="callnote">Opening the line…</p>,
});

type Source = { l: string; u: string };
type Citation = { id: string; name: string; place: string; sources: Source[] };
type Turn = {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly refused: boolean;
  /** The language the question was measured to be in, or null when typed. */
  readonly lang: string | null;
  /** Asked out loud — so the answer is read back without being asked to be. */
  readonly spoken: boolean;
};

/** What the microphone last heard, kept until the question is asked or cleared. */
type Heard = {
  readonly language: string | null;
  readonly label: string | null;
  readonly speakable: boolean;
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
  const [heard, setHeard] = useState<Heard | null>(null);
  /** Bumped to silence any playback from outside — closing must not keep talking. */
  const [halt, setHalt] = useState(0);
  /**
   * Typed chat or a spoken call. One panel, two modes, rather than two floating
   * launchers: they answer the same question from the same records, and offering
   * them as rival products would imply otherwise.
   */
  const [mode, setMode] = useState<"type" | "call">("type");

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setOpen(false);
    // A closed panel must not leave an answer reciting into an empty room.
    setHalt((n) => n + 1);
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

    // Captured before the state is cleared: the answer belongs to the language
    // THIS question was heard in, even if the next one is typed.
    const askedLanguage = heard?.language ?? null;
    const askedAloud = heard !== null;

    const controller = new AbortController();
    abortRef.current = controller;
    setTurns((prev) => [
      ...prev,
      { id: nextId++, role: "user", text: asked, citations: [], refused: false, lang: askedLanguage, spoken: askedAloud },
    ]);
    setQuestion("");
    setHeard(null);
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question: asked,
          // The same memory the call has. A typed follow-up — "and who built
          // it?" — is as common as a spoken one, and refusing it because the
          // pronoun names no temple is the same defect either way.
          history: turns.slice(-4).map((t) => ({ role: t.role, content: t.text })),
          context: (turns.filter((t) => t.role === "assistant").at(-1)?.citations ?? [])
            .slice(0, 3).map((c) => c.id),
          // A spoken question carries the language the speech API DETECTED —
          // measured, not guessed. Only a typed one falls back to the browser
          // locale, which is a hint about the device rather than about the asker.
          language: askedLanguage ?? (typeof navigator === "undefined" ? undefined : navigator.language),
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
          lang: askedLanguage,
          // Read back only when the question was asked out loud: a typed
          // question has not consented to sound.
          spoken: askedAloud && response.ok && Boolean(payload.answer),
        },
      ]);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      setTurns((prev) => [
        ...prev,
        { id: nextId++, role: "assistant", text: UNAVAILABLE_TEXT, citations: [], refused: true, lang: askedLanguage, spoken: false },
      ]);
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }, [question, pending, heard]);

  /**
   * A spoken question arrives here, and stops here. It is written into the
   * input box — visible, editable, unsent — because a mis-transcription that
   * goes straight to an answer cannot be told apart from the assistant
   * misunderstanding the question.
   */
  const onTranscript = useCallback((result: VoiceTranscript) => {
    setQuestion(result.text.slice(0, MAX_CHARS));
    setHeard({ language: result.language, label: result.label, speakable: result.speakable });
    inputRef.current?.focus();
  }, []);

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

        <div className="asstmodes" role="tablist" aria-label="How to ask">
          <button type="button" role="tab" aria-selected={mode === "type"}
            className={`asstmode${mode === "type" ? " on" : ""}`} onClick={() => setMode("type")}>
            Type
          </button>
          <button type="button" role="tab" aria-selected={mode === "call"}
            className={`asstmode${mode === "call" ? " on" : ""}`} onClick={() => setMode("call")}>
            Speak
          </button>
        </div>

        {mode === "call" ? <CallPanel onClose={() => setMode("type")} /> : (
        <>
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

              {turn.role === "assistant" && (turn.spoken || turn.lang) && (
                <SpeakButton text={turn.text} language={turn.lang} autoPlay={turn.spoken} halt={halt} />
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
            onChange={(event) => {
              setQuestion(event.target.value);
              // Emptying the box ends the spoken question; a fresh typed one
              // must not inherit the language of the last thing that was said.
              if (!event.target.value.trim()) setHeard(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
          />
          {heard && (
            <p className="voxheard" role="status">
              Heard in <b>{heard.label ?? "an unrecognised language"}</b>. Check it, correct anything wrong, then ask.
              {!heard.speakable && " The answer will be text only — the atlas cannot read that language aloud yet."}
            </p>
          )}

          <div className="asstactions">
            <VoiceButton onTranscript={onTranscript} disabled={pending} />
            <span className="asstcount" aria-hidden="true">
              {question.length}/{MAX_CHARS}
            </span>
            <button type="submit" className="asstsend" disabled={pending || !question.trim()}>
              {pending ? "Asking…" : "Ask"}
            </button>
          </div>
        </form>
        </>
        )}
      </section>
    </>
  );
}
