"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type HeaderStats = { sites: number; countries: number; traditions: number; centuries: number };

import LanguagePicker from "./LanguagePicker";
import { useUiLanguage } from "./useUiLanguage";
import type { UiKey } from "@/lib/ui-strings";

type NavLink = { href: string; key: UiKey; noteKey: UiKey; match?: string };

const NAV_LINKS: NavLink[] = [
  { href: "/", key: "nav.atlas", noteKey: "nav.atlas.note" },
  { href: "/sites", key: "nav.gazetteer", noteKey: "nav.gazetteer.note", match: "/site/" },
  { href: "/circuits", key: "nav.circuits", noteKey: "nav.circuits.note", match: "/circuit/" },
  { href: "/dynasties", key: "nav.dynasties", noteKey: "nav.dynasties.note", match: "/dynasty/" },
  { href: "/deities", key: "nav.deities", noteKey: "nav.deities.note", match: "/deity/" },
  { href: "/patrons", key: "nav.patrons", noteKey: "nav.patrons.note", match: "/patron/" },
  { href: "/about", key: "nav.about", noteKey: "nav.about.note" },
];

const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])';

const isCurrent = (pathname: string, link: NavLink) =>
  pathname === link.href || (!!link.match && pathname.startsWith(link.match));

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <g fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M16 3 L16 7" />
        <path d="M12 9 Q16 4 20 9" />
        <path d="M9 13 Q16 6 23 13" />
        <path d="M6 18 Q16 8 26 18" />
        <path d="M8 18 L8 27 M16 14 L16 27 M24 18 L24 27" />
        <path d="M4 27 L28 27" />
      </g>
    </svg>
  );
}

/**
 * The one header used by every page — atlas and content alike.
 *
 * `onIndexToggle` is supplied only by the atlas (home) page, where the Index is a
 * panel state rather than a route; everywhere else the menu links to /sites instead.
 */
export default function SiteHeader({
  stats,
  indexOpen = false,
  onIndexToggle,
  actions,
  note,
}: {
  stats: HeaderStats;
  indexOpen?: boolean;
  onIndexToggle?: () => void;
  /**
   * Controls that belong to the PAGE, rendered at the end of the header row.
   *
   * The atlas puts its search and filter buttons here. On a phone that is worth
   * two whole rows: search and filters had a row of their own and the live
   * count had another, which together took about a fifth of the viewport from
   * the map they describe.
   */
  actions?: React.ReactNode;
  /** A short status for the end of the coverage row — the atlas's live count. */
  note?: React.ReactNode;
}) {
  const { t, lang } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Close on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Focus trap, Esc to close, and a scroll lock while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    drawer.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  const indexIsCurrent = !!onIndexToggle && indexOpen;

  return (
    <>
      <header className="sitehead">
        <div className="headlead">
          <button
            ref={toggleRef}
            type="button"
            className={`hamb ${open ? "on" : ""}`}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? t("nav.close") : t("nav.open")}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="hambox" aria-hidden="true"><i /><i /><i /></span>
          </button>
          <Link href="/" className="brand" aria-label="Tirtha Atlas — home">
            <BrandMark />
            <span className="t">Tirtha <b>Atlas</b></span>
          </Link>
        </div>

        <p className="tag">
          The sacred geography of the Indic world — every site mapped, dated, storied, and cited.
        </p>

        <div className="hstats" aria-label="Atlas coverage">
          <span className="st"><b>{stats.sites}</b> <span lang={lang}>{t("stats.sites")}</span></span>
          <span className="st"><b>{stats.countries}</b> <span lang={lang}>{t("stats.countries")}</span></span>
          <span className="st st-trad"><b>{stats.traditions}</b> <span lang={lang}>{t("stats.traditions")}</span></span>
          <span className="st st-cent"><b>{stats.centuries}</b> <span lang={lang}>{t("stats.centuries")}</span></span>
          {note ? <span className="hnote">{note}</span> : null}
        </div>

        <div className="hactions">
          {actions}
          <LanguagePicker />
        </div>
      </header>

      <div
        className={`navscrim ${open ? "open" : ""}`}
        onClick={() => close()}
        aria-hidden="true"
      />

      <nav
        id={menuId}
        ref={drawerRef}
        className={`navdrawer ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        inert={!open}
      >
        <div className="navhead">
          <span className="eyebrow" lang={lang}>{t("nav.heading")}</span>
          <button type="button" className="navclose" onClick={() => close(true)} aria-label={t("nav.close")}>×</button>
        </div>

        <ul className="navlist">
          {NAV_LINKS.map((link) => {
            const current = isCurrent(pathname, link);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`navitem ${current ? "cur" : ""}`}
                  aria-current={current ? "page" : undefined}
                  onClick={() => close()}
                >
                  {/* lang on the label so a screen reader switches voice, and so
                      Indic text inherits the taller line-height rather than the
                      Latin body default that clips its matras. */}
                  <span className="nl" lang={lang}>{t(link.key)}</span>
                  <span className="nn" lang={lang}>{t(link.noteKey)}</span>
                </Link>
              </li>
            );
          })}
          <li>
            {onIndexToggle ? (
              <button
                type="button"
                className={`navitem ${indexIsCurrent ? "cur" : ""}`}
                aria-pressed={indexOpen}
                onClick={() => { onIndexToggle(); close(); }}
              >
                <span className="nl" lang={lang}>{t("nav.index")}</span>
                <span className="nn" lang={lang}>{t("nav.index.note")}</span>
              </button>
            ) : (
              <Link href="/sites" className="navitem" onClick={() => close()}>
                <span className="nl" lang={lang}>{t("nav.index")}</span>
                <span className="nn" lang={lang}>{t("nav.index.note")}</span>
              </Link>
            )}
          </li>
        </ul>

        <p className="navfoot">
          {stats.sites} sites · {stats.countries} countries · {stats.traditions} traditions · {stats.centuries} centuries.
          Every entry cites its sources.
        </p>
      </nav>
    </>
  );
}
