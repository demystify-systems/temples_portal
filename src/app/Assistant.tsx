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
import { useUiLanguage } from "./useUiLanguage";
import { useDraggableLauncher } from "./useDraggableLauncher";
import { usePathname } from "next/navigation";
import { TempleBell } from "./TempleBell";

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

/**
 * The speech-to-speech panel, loaded only when someone opens Speak.
 *
 * Kept separate from CallPanel rather than replacing it: Voice Agents needs a
 * dashboard key this deployment may not have, and answers on that path are not
 * bound by the citation rule. When it is not configured the cited cascade is
 * what runs, so the feature degrades to something honest rather than to nothing.
 */
const VoiceAgentPanel = dynamic(() => import("./VoiceAgentPanel"), {
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
  /** Still arriving. Renders the caret and suppresses the citation block. */
  readonly streaming?: boolean;
  /** The answer stops early — the call ended before the model finished. */
  readonly truncated?: boolean;
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

/**
 * What each server stage is called on screen.
 *
 * Each one names work that is actually happening — the stages are emitted by
 * the route as it reaches them, not on a timer. A progress message that is
 * really a stopwatch is a lie the first time something runs slowly.
 */
const STAGE_LABELS: Record<string, string> = {
  retrieving: "Searching the atlas",
  reading: "Reading the records",
  consulting: "Looking up more records",
  writing: "Writing the answer",
};

const stageLabel = (s: { stage: string; records?: number } | null): string => {
  if (!s) return "Searching the atlas";
  if (s.stage === "reading" && typeof s.records === "number" && s.records > 0) {
    return `Reading ${s.records.toLocaleString()} matching record${s.records === 1 ? "" : "s"}`;
  }
  return STAGE_LABELS[s.stage] ?? "Working";
};

/** How long the swing runs. Matches `bell-ring` in globals.css. */
const RING_MS = 1500;

export default function Assistant() {
  /**
   * The page the reader is on, sent with every question.
   *
   * "Who built this?" is the commonest thing anyone types while looking at a
   * temple, and without the route it is a question with no subject.
   */
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  /**
   * The swing is deliberately not tied to `open`. A bell rings when it is
   * struck, including the strike that closes the panel again — tying it to the
   * opened state would leave every second tap silent.
   */
  const [ringing, setRinging] = useState(false);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (ringTimer.current) clearTimeout(ringTimer.current); }, []);
  const strike = useCallback(() => {
    // Cleared first so a rapid second tap restarts the swing rather than being
    // swallowed by the animation already running.
    setRinging(false);
    requestAnimationFrame(() => setRinging(true));
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = setTimeout(() => setRinging(false), RING_MS);
  }, []);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [pending, setPending] = useState(false);
  /** What the server is doing right now, so the wait is legible rather than blank. */
  const [stage, setStage] = useState<{ stage: string; records?: number } | null>(null);
  const [heard, setHeard] = useState<Heard | null>(null);
  /** Bumped to silence any playback from outside — closing must not keep talking. */
  const [halt, setHalt] = useState(0);
  /**
   * Typed chat or a spoken call. One panel, two modes, rather than two floating
   * launchers: they answer the same question from the same records, and offering
   * them as rival products would imply otherwise.
   */
  /**
   * Opens on Speak. The panel's headline capability is a spoken conversation;
   * typing is still one tap away and is what a reader wanting a citation uses.
   */
  const [mode, setMode] = useState<"type" | "call">("call");
  const { t, lang } = useUiLanguage();
  const launcher = useDraggableLauncher();
  /**
   * Whether this deployment has a Voice Agent. `null` while unknown, so the
   * panel shows neither implementation until it can pick the right one — a
   * flash of the slower cascade that is then replaced reads as a bug.
   */
  const [voiceAgent, setVoiceAgent] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/voice-agent/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVoiceAgent(Boolean(d?.configured)))
      .catch(() => setVoiceAgent(false));
  }, []);

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

    // The turn the answer streams into, created empty so the reader sees the
    // reply take shape rather than a spinner that ends in a wall of text.
    const answerId = nextId++;
    setTurns((prev) => [...prev, {
      id: answerId, role: "assistant", text: "", citations: [], refused: false,
      lang: askedLanguage, spoken: false, streaming: true,
    }]);
    setStage({ stage: "retrieving" });

    const settle = (patch: Partial<Turn>) =>
      setTurns((prev) => prev.map((t) => (t.id === answerId ? { ...t, ...patch, streaming: false } : t)));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        signal: controller.signal,
        body: JSON.stringify({
          question: asked,
          stream: true,
          page: pathname,
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

      // Rate limits and validation answer in JSON before the stream ever opens.
      if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        const payload = ((await response.json().catch(() => null)) ?? {}) as
          { answer?: string; citations?: Citation[]; refused?: boolean; error?: string };
        settle({
          text: payload.answer ?? (response.status === 429 && payload.error ? payload.error : UNAVAILABLE_TEXT),
          citations: response.ok ? (payload.citations ?? []) : [],
          refused: Boolean(payload.refused) || !response.ok,
          spoken: askedAloud && response.ok && Boolean(payload.answer),
        });
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let sse = "";
      let streamed = "";
      let closed = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse += decoder.decode(value, { stream: true });

        // Frames are separated by a blank line; a partial one waits.
        let split: number;
        while ((split = sse.indexOf("\n\n")) !== -1) {
          const frame = sse.slice(0, split);
          sse = sse.slice(split + 2);

          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const raw = /^data: (.*)$/m.exec(frame)?.[1];
          if (!event || !raw) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(raw); } catch { continue; }

          if (event === "stage") {
            setStage({ stage: String(data.stage), records: data.records as number | undefined });
          } else if (event === "text") {
            streamed += String(data.chunk ?? "");
            setTurns((prev) => prev.map((t) => (t.id === answerId ? { ...t, text: streamed } : t)));
          } else if (event === "done") {
            const payload = data as unknown as
              { answer?: string; citations?: Citation[]; refused?: boolean; truncated?: boolean };
            // The authoritative payload replaces the streamed text. Both went
            // through the same rule, so this is a confirmation, not a rewrite.
            settle({
              text: payload.answer ?? streamed ?? UNAVAILABLE_TEXT,
              citations: payload.citations ?? [],
              refused: Boolean(payload.refused),
              truncated: Boolean(payload.truncated),
              spoken: askedAloud && Boolean(payload.answer),
            });
            closed = true;
          } else if (event === "error") {
            // Keep whatever already arrived. It was vetted on the way out, the
            // reader has read it, and replacing a real answer with "unavailable"
            // because the last sentence never came is worse than saying it
            // stops early — that was the actual bug behind an answer vanishing
            // after half a minute on screen.
            settle(streamed.trim()
              ? { text: streamed, citations: [], refused: false, truncated: true, spoken: false }
              : { text: UNAVAILABLE_TEXT, citations: [], refused: true, spoken: false });
            closed = true;
          }
        }
      }

      // The connection ended without a verdict — a dropped socket. Same rule:
      // text that reached the reader was already checked, so it stays, marked
      // as ending early.
      if (!closed) {
        settle(streamed.trim()
          ? { text: streamed, citations: [], refused: false, truncated: true, spoken: false }
          : { text: UNAVAILABLE_TEXT, citations: [], refused: true, spoken: false });
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        setTurns((prev) => prev.filter((t) => t.id !== answerId));
        return;
      }
      settle({ text: UNAVAILABLE_TEXT, citations: [], refused: true, spoken: false });
    } finally {
      abortRef.current = null;
      setPending(false);
      setStage(null);
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
        // Two owners, one node: `launcherRef` returns focus here when the panel
        // closes, and the drag hook measures the button to clamp it on screen.
        ref={(node) => {
          launcherRef.current = node;
          launcher.ref.current = node;
        }}
        type="button"
        className={`asstlaunch${launcher.dragging ? " dragging" : ""}${ringing ? " ringing" : ""}`}
        aria-expanded={open}
        aria-controls="asst-panel"
        style={launcher.style}
        {...launcher.handlers}
        // A drag must not also open the panel. The hook reports which gesture
        // just finished; without this, moving the button out of the way opens
        // the very panel you were moving it away from.
        onClick={() => { if (launcher.wasTap()) { strike(); setOpen((was) => !was); } }}
        onDoubleClick={launcher.reset}
        aria-label={t("assistant.title")}
        title={`${t("assistant.title")} · drag to move, double-click to put it back`}
      >
        <TempleBell />
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
            <h2 id="asst-title" lang={lang}>{t("assistant.title")}</h2>
            <p className="asstsub" lang={lang}>{t("assistant.scope")}</p>
          </div>
          <button type="button" className="asstclose" onClick={close} aria-label="Close the assistant">
            ×
          </button>
        </header>

        <div className="asstmodes" role="tablist" aria-label="How to ask">
          {/* Speak leads. Talking is the thing this panel is for now that it is
              a real conversation rather than a form with a microphone; typing is
              the considered alternative, and the one that carries citations. */}
          <button type="button" role="tab" aria-selected={mode === "call"}
            className={`asstmode${mode === "call" ? " on" : ""}`} onClick={() => setMode("call")}>
            <span lang={lang}>{t("assistant.speak")}</span>
          </button>
          <button type="button" role="tab" aria-selected={mode === "type"}
            className={`asstmode${mode === "type" ? " on" : ""}`} onClick={() => setMode("type")}>
            <span lang={lang}>{t("assistant.type")}</span>
          </button>
        </div>

        {mode === "call" ? (
          voiceAgent === null
            ? <p className="callnote">Opening the line…</p>
            : voiceAgent
              ? <VoiceAgentPanel onClose={() => setMode("type")} />
              : <CallPanel onClose={() => setMode("type")} />
        ) : (
        <>
        <div className="asstlog" ref={logRef} role="log" aria-live="polite" aria-atomic="false">
          {turns.length === 0 && <p className="asstopener">{OPENER}</p>}

          {turns.map((turn) => (
            <article key={turn.id} className={`asstturn ${turn.role}`}>
              <p className={`assttext${turn.streaming ? " streaming" : ""}`} dir="auto">
                {turn.text}
                {turn.streaming && turn.text.trim() && <span className="caret" aria-hidden="true" />}
              </p>

              {turn.role === "assistant" && !turn.streaming && (
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

              {/* An answer that stops early is still an answer — say so rather
                  than throwing it away. See the catch in /api/chat. */}
              {turn.truncated && !turn.streaming && (
                <p className="assttrunc" role="note">
                  This answer stops early — the assistant ran out of time before finishing. Ask again for the rest.
                </p>
              )}

              {/* Read aloud, on EVERY answer rather than only spoken ones. It
                  auto-plays only when the question was asked out loud: a typed
                  question has not consented to sound. */}
              {turn.role === "assistant" && !turn.streaming && turn.text.trim() && (
                <SpeakButton text={turn.text} language={turn.lang} autoPlay={turn.spoken} halt={halt} />
              )}
            </article>
          ))}

          {/* `.trim()` matters: answers often open with a newline, and a chunk
              that is only whitespace would hide the stage readout while there
              is still nothing on screen to replace it. */}
          {pending && !turns.some((t) => t.streaming && t.text.trim()) && (
            <p className="asstpending" role="status">
              <span className="asstdots" aria-hidden="true"><i /><i /><i /></span>
              {stageLabel(stage)}…
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
