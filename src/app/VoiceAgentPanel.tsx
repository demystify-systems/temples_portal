"use client";

/**
 * Speech-to-speech, over Sarvam Voice Agents.
 *
 * WHY THIS REPLACED THE CASCADE
 * -----------------------------
 * The previous call recorded an utterance, uploaded it, waited for a transcript,
 * asked the model, waited for the whole answer, then synthesised it. Measured
 * against production: **14.3 seconds** to first sound —
 *
 *   VAD silence 1.00s · speech->text 2.13s · text->answer 7.67s · TTS 3.52s
 *
 * — which is not a conversation, it is a form submission with a microphone.
 *
 * This is one WebSocket. Audio goes in, audio comes out, and Sarvam's server
 * does voice-activity detection, turn-taking and barge-in. The SDK surfaces
 * those as `user_speech_start`, `user_speech_end` and `user_interrupt`, so none
 * of the timing logic lives here.
 *
 * WHAT THIS PATH DOES NOT GUARANTEE — read before changing the copy
 * ----------------------------------------------------------------
 * A Voice Agent's prompt, tools and knowledge base are authored in Sarvam's
 * dashboard, NOT in this repository. Answers here therefore do not come from
 * data/sites.json and are NOT bound by CLAUDE.md rule 2 — no source, no field,
 * no publish — which every other surface in this atlas enforces.
 *
 * That is a deliberate product decision, and it is why the panel says so on its
 * face rather than in a comment. The typed assistant still answers only from
 * cited records, and the `/api/chat` path is unchanged. Someone who needs a
 * citation has a route to one; someone who wants to talk has a route to that.
 * Blurring the two would be the actual failure.
 *
 * THE KEY NEVER REACHES THE BROWSER
 * ---------------------------------
 * `baseUrl` points at our own proxy, which performs the signed-URL handshake
 * server-side with the real key. The browser only ever holds a short-lived URL
 * scoped to one conversation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentState, InteractionType } from "sarvam-conv-ai-sdk/browser";
import type { ConversationAgent as Agent } from "sarvam-conv-ai-sdk/browser";
import { SPOKEN_LANGUAGES, languageByCode } from "@/lib/ai/languages";
import { readPreference, writePreference, PREF_KEYS } from "@/lib/preference";

/**
 * The languages Voice Agents can be started in, mapped from our own tags.
 *
 * ELEVEN, not the twenty-two the typed assistant understands. `SarvamToolLanguageName`
 * is a closed enum, so offering Sanskrit or Kashmiri here would be offering a
 * language the socket will refuse — worse than not offering it, because the
 * refusal arrives after someone has already started speaking.
 *
 * The picker on this panel is filtered to these; the typed assistant keeps all
 * twenty-two, and the note under the picker says which is which.
 */
/*
 * The eleven languages a Voice Agent can be started in.
 *
 * Written out rather than imported, because `SarvamToolLanguageName` is not
 * reachable from ANY public entry point of the SDK: dist/types/language.d.ts
 * defines it, dist/types/index.d.ts does not re-export it, and the package's
 * `exports` map blocks a deep import. Checked, not assumed.
 *
 * The mismatch this guards is real: the typed assistant understands twenty-two
 * languages and this socket accepts eleven. Offering Sanskrit or Kashmiri here
 * would fail AFTER someone had started speaking, which is the worst possible
 * moment to find out. voice-agent.test.ts pins the list so that an upstream
 * change shows up in a diff rather than in a dropped call.
 */
const AGENT_LANGUAGES = {
  "en-IN": "English",
  "hi-IN": "Hindi",
  "bn-IN": "Bengali",
  "gu-IN": "Gujarati",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "od-IN": "Odia",
  "pa-IN": "Punjabi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
} as const;

/** What the reader is told the call is doing. Also the screen-reader announcement. */
const STATE_LABEL: Readonly<Record<string, string>> = {
  idle: "Not connected",
  connecting: "Connecting",
  connected: "Connected",
  listening: "Listening",
  speaking: "Answering",
  error: "The line dropped",
};

type Turn = { readonly id: number; readonly role: "user" | "agent"; readonly text: string };
let turnId = 0;

export default function VoiceAgentPanel({ onClose }: { readonly onClose: () => void }) {
  const [state, setState] = useState<AgentState>(AgentState.IDLE);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const agentRef = useRef<Agent | null>(null);

  useEffect(() => {
    setLanguage(readPreference<string | null>(PREF_KEYS.voiceLanguage, null));
  }, []);

  const stop = useCallback(async () => {
    const agent = agentRef.current;
    agentRef.current = null;
    setLevel(0);
    if (agent) { try { await agent.stop(); } catch { /* already gone */ } }
    setState(AgentState.IDLE);
  }, []);

  // Hanging up on unmount is not optional: the socket holds a live microphone,
  // and a panel closed without stopping it keeps listening.
  useEffect(() => () => { void stop(); }, [stop]);

  const start = useCallback(async () => {
    if (agentRef.current) return;
    setError(null);
    setState(AgentState.CONNECTING);
    try {
      // Imported here rather than at module scope so the SDK — and the
      // AudioContext machinery it pulls in — costs nothing to anyone who never
      // opens the call.
      const { ConversationAgent, BrowserAudioInterface } = await import("sarvam-conv-ai-sdk/browser");

      const settings = await fetch("/api/voice-agent/config").then((r) => (r.ok ? r.json() : null));
      if (!settings?.orgId) {
        setError("The spoken assistant is not configured on this deployment.");
        setState(AgentState.IDLE);
        return;
      }

      const agent = new ConversationAgent({
        // The proxy authenticates; this value is never a real key. The SDK
        // requires the field, so it is given a placeholder rather than a secret.
        apiKey: "proxied",
        baseUrl: "/api/voice-agent/",
        audioInterface: new BrowserAudioInterface(),
        config: {
          org_id: settings.orgId,
          workspace_id: settings.workspaceId,
          app_id: settings.appId,
          /**
           * "custom", not "anonymous" — and this is the whole reason the Speak
           * tab was dead.
           *
           * `anonymous` reads like the privacy-preserving choice and is what
           * this sent for weeks. Sarvam accepts it at the handshake, issues a
           * signed URL, and then refuses the socket with a bare 403 and no
           * message. Isolated by running Sarvam's own widget against the same
           * agent and diffing the two URLs: that one parameter was the only
           * difference, and flipping it opens the socket.
           *
           * No privacy is given up. `user_identifier` below is the constant
           * "web" for every visitor, so "custom" here means "an identifier we
           * chose", not "an identity we tracked".
           */
          user_identifier_type: "custom",
          // No identity is sent. A pilgrim asking about a temple is not
          // something this project records, and a stable id would make the
          // conversation linkable across visits.
          user_identifier: "web",
          interaction_type: InteractionType.CALL,
          // Without this the signed-URL request 404s. See the note on
          // `version` in src/lib/ai/voice-agent.ts.
          // Omitted unless a version is pinned: the handshake resolves the
          // live published version on its own, so sending nothing means a
          // publish is picked up without a redeploy. The earlier 404 that this
          // was added for came from the old key, not from the missing version.
          ...(typeof settings.version === "number" ? { version: settings.version } : {}),
          input_sample_rate: 16000,
          output_sample_rate: 22050,
          ...(language && language in AGENT_LANGUAGES ? { initial_language_name: AGENT_LANGUAGES[language as keyof typeof AGENT_LANGUAGES] as never } : {}),
        },
        stateCallback: (next) => setState(next),
        audioLevelCallback: (l) => setLevel(typeof l === "number" ? l : 0),
        transcriptCallback: async (msg) => {
          const text = (msg as { text?: string })?.text?.trim();
          if (text) setTurns((prev) => [...prev, { id: turnId++, role: "user", text }]);
        },
        textCallback: async (msg) => {
          const text = (msg as { text?: string })?.text?.trim();
          if (text) setTurns((prev) => [...prev, { id: turnId++, role: "agent", text }]);
        },
        endCallback: async () => { setState(AgentState.IDLE); agentRef.current = null; },
      });

      agentRef.current = agent;
      await agent.start();
    } catch (e) {
      // The commonest cause by far is a refused microphone, so that is the
      // sentence a reader gets — not the SDK's own error text.
      setError(
        (e as Error)?.name === "NotAllowedError"
          ? "The microphone is blocked for this site. Allow it, or use the Type tab."
          : "The line could not be opened. You can type the question instead.",
      );
      setState(AgentState.IDLE);
      agentRef.current = null;
    }
  }, [language]);

  const live = state === AgentState.LISTENING;
  const busy = state === AgentState.CONNECTING || state === AgentState.CONNECTED;
  const running = state !== AgentState.IDLE && state !== AgentState.ERROR;
  const chosen = languageByCode(language);

  return (
    <section className="call" aria-label="Talk to Tirtha Atlas">
      <div className="calllang">
        <label htmlFor="va-lang">Speak in</label>
        <select
          id="va-lang"
          value={language ?? ""}
          disabled={running}
          onChange={(e) => {
            const next = e.target.value || null;
            setLanguage(next);
            writePreference(PREF_KEYS.voiceLanguage, next);
          }}
        >
          <option value="">Detect automatically</option>
          {SPOKEN_LANGUAGES.filter((l) => l.code in AGENT_LANGUAGES).map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>{l.endonym}</option>
          ))}
        </select>
      </div>

      <div className="callstage">
        <button
          className={`orb ${running ? "on" : ""} ${live ? "hear" : ""}`}
          onClick={running ? () => void stop() : () => void start()}
          aria-label={running ? "End the call" : "Start talking to the atlas"}
        >
          <span
            className="orbring"
            style={{ transform: `scale(${live ? 1 + Math.min(0.55, level * 3.2) : 1})` }}
            aria-hidden="true"
          />
          <span className="orbcore" aria-hidden="true">{running ? "End" : "Talk"}</span>
        </button>

        <p className={`callphase mono ${busy ? "busy" : ""}`} role="status" aria-live="polite">
          {state === AgentState.IDLE
            ? "Press to talk. Interrupt any time — it stops and listens."
            : STATE_LABEL[state] ?? state}
        </p>
        {chosen && running && (
          <p className="callheard">Speaking in <b lang={chosen.code}>{chosen.endonym}</b></p>
        )}
      </div>

      {error && <p className="callerr" role="alert">{error}</p>}

      {/* Stated plainly, because it is the one thing that differs from every
          other surface in the atlas. Someone who needs a citation is told where
          to get one rather than left to assume this answer carries it. */}
      <p className="callnote">
        This is a spoken assistant and it answers in its own words. It is not
        reading from the atlas&rsquo;s cited records — for a sourced answer, use{" "}
        <b>Type</b>, which only ever quotes records that carry a citation.
      </p>

      {turns.length > 0 && (
        <ol className="calllog">
          {turns.map((t) => (
            <li key={t.id} className={`callturn ${t.role === "user" ? "user" : "assistant"}`}>
              <p>{t.text}</p>
            </li>
          ))}
        </ol>
      )}

      <button className="callx" onClick={onClose} aria-label="Close">×</button>
    </section>
  );
}
