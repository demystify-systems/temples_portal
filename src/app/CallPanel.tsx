"use client";

/**
 * The call surface — "Speak to the Atlas".
 *
 * Deliberately NOT a second chat window. A call has one job on screen: tell you
 * whether it is listening, so you know when to talk. Everything else is
 * secondary, and the transcript below is a record of what was said rather than
 * the thing you interact with.
 *
 * The two states a voice UI must never blur are "the microphone is open" and
 * "the machine is busy". A person who cannot tell them apart talks over the
 * assistant and loses their question. So the orb reacts to the live input level
 * while listening and stops reacting the moment the turn closes, and the phase
 * line says what is happening in words — which is also the screen-reader
 * announcement, via aria-live.
 */

import { useCall } from "./useCall";
import { SPOKEN_LANGUAGES, languageByCode } from "@/lib/ai/languages";

/** Cap the orb's growth so a loud room does not push it off its own row. */
const scaleFor = (level: number): number => 1 + Math.min(0.55, level * 3.2);

export default function CallPanel({ onClose }: { readonly onClose: () => void }) {
  const call = useCall();
  const chosen = languageByCode(call.language);
  const live = call.phase === "listening" || call.phase === "capturing";
  const busy = call.phase === "transcribing" || call.phase === "thinking";

  return (
    <section className="call" aria-label="Talk to Tirtha Atlas">
      <header className="callhead">
        <div>
          <h2>Talk to Tirtha Atlas</h2>
          <p className="callsub mono">ANSWERS ONLY FROM CITED RECORDS</p>
        </div>
        <button className="callx" onClick={onClose} aria-label="Close">×</button>
      </header>

      {/* The picker is the INVITATION as much as the setting. Without it the
          interface is in English and reads as an English product that will not
          understand you; with it, someone who would rather ask in Tamil can see
          that they may. Every option is an endonym — a Tamil speaker looks for
          தமிழ், not for the English word "Tamil". */}
      <div className="calllang">
        <label htmlFor="call-lang">Speak in</label>
        <select
          id="call-lang"
          value={call.language ?? ""}
          onChange={(e) => call.setLanguage(e.target.value || null)}
        >
          <option value="">Detect automatically</option>
          {SPOKEN_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.endonym}{l.speakable ? "" : " — text reply only"}
            </option>
          ))}
        </select>
      </div>

      {chosen && !chosen.speakable && (
        <p className="callnote">
          The atlas understands {chosen.endonym} but cannot read an answer back aloud in it yet.
          Ask in {chosen.endonym} and the reply will appear as text.
        </p>
      )}

      {!call.supported ? (
        <p className="callnote">
          This browser cannot open a microphone. You can still type the question.
        </p>
      ) : (
        <div className="callstage">
          <button
            className={`orb ${call.phase === "idle" ? "" : "on"} ${call.phase === "capturing" ? "hear" : ""}`}
            onClick={call.phase === "idle" ? call.start : call.stop}
            aria-label={call.phase === "idle" ? "Start speaking to the atlas" : "End the call"}
          >
            <span
              className="orbring"
              // Only while genuinely listening. A ring that keeps pulsing during
              // transcription reads as "still hearing you" and invites the person
              // to keep talking into a microphone that is no longer their turn.
              style={{ transform: `scale(${live ? scaleFor(call.level) : 1})` }}
              aria-hidden="true"
            />
            <span className="orbcore" aria-hidden="true">{call.phase === "idle" ? "Call" : "End"}</span>
          </button>

          <p className={`callphase mono ${busy ? "busy" : ""}`} role="status" aria-live="polite">
            {call.phase === "idle" ? "Press to start. It listens, and answers aloud." : call.label}
          </p>

          {/* A wrong detection is visible BEFORE it becomes a wrong-language
              answer. Shown only when it disagrees with the choice, so it is a
              signal rather than noise on every turn. */}
          {call.heard && call.language && call.heard !== call.language && (
            <p className="callheard" role="status">
              Heard in <b lang={call.heard}>{languageByCode(call.heard)?.endonym ?? call.heard}</b>,
              not {chosen?.endonym}. Answering in what was heard.
            </p>
          )}
        </div>
      )}

      {call.error && <p className="callerr" role="alert">{call.error}</p>}

      {call.turns.length > 0 && (
        <ol className="calllog">
          {call.turns.map((turn) => (
            <li key={turn.id} className={`callturn ${turn.role}`}>
              <p>{turn.text}</p>
              {turn.citations.length > 0 && (
                <ul className="callcites">
                  {turn.citations.map((c) => (
                    <li key={c.id}><a href={c.url}>{c.name}</a></li>
                  ))}
                </ul>
              )}
              {/* An answer with no citation says so, rather than leaving a blank
                  where a source should be — the same posture as the typed
                  assistant, and the reason this is a reference work. */}
              {turn.role === "assistant" && turn.citations.length === 0 && (
                <p className="callnocite">No sourced record matched, so nothing was cited — and nothing was asserted.</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
