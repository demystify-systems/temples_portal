"use client";

/**
 * The interface language, in the header.
 *
 * Every option is an ENDONYM — the language's own name in its own script. A
 * reader looking for Tamil is looking for தமிழ், and showing them the English
 * word "Tamil" in Latin script is the same failure as answering in the wrong
 * language, made one step earlier: it asks them to read English in order to
 * stop reading English.
 *
 * The note underneath is not a disclaimer, it is the feature's honest boundary.
 * Switching to Tamil translates the navigation and the buttons; it does not
 * translate a temple's history, because that history was written from cited
 * sources and a machine translation of it would be an uncited claim wearing a
 * citation. The note says so, in the language just chosen, and points at the
 * thing that DOES answer in Tamil from those same sources.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useUiLanguage } from "./useUiLanguage";

export default function LanguagePicker() {
  const { lang, setLang, available, t } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = available.find((l) => l.code === lang);

  return (
    <div className="langpick" ref={boxRef}>
      <button
        type="button"
        className={`langbtn${open ? " on" : ""}`}
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("lang.label")}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none"
          stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="7.2" />
          <path d="M2.8 10h14.4M10 2.8c1.9 2 2.9 4.5 2.9 7.2s-1 5.2-2.9 7.2c-1.9-2-2.9-4.5-2.9-7.2S8.1 4.8 10 2.8Z" />
        </svg>
        <span className="langcur" lang={current?.code}>{current?.endonym ?? "English"}</span>
      </button>

      {open && (
        <div className="langmenu" id={id} role="listbox" aria-label={t("lang.label")}>
          <ul>
            {available.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={l.code === lang}
                  className={l.code === lang ? "on" : undefined}
                  onClick={() => { setLang(l.code); setOpen(false); }}
                >
                  {/* The endonym leads; the English name is the smaller second
                      line, for a reader who has landed here by accident and
                      needs to get back. */}
                  <span className="langendo" lang={l.code}>{l.endonym}</span>
                  <span className="langeng">{l.english}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="langnote">{t("lang.note")}</p>
        </div>
      )}
    </div>
  );
}
