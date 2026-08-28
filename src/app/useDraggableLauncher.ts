"use client";

/**
 * A launcher you can move, that stays where you put it.
 *
 * The button was pinned to the bottom-right, which is the right default and the
 * wrong permanent home: the timeline grew to 143px on a phone and the launcher
 * landed squarely on the era buttons and the year slider — a control covering a
 * control. Raising it above the timeline fixes that one collision and cannot fix
 * the general case, because what it covers depends on the screen, the record
 * open, and which hand is holding the phone.
 *
 * So it is draggable, and the position is remembered.
 *
 * Stored as a FRACTION of the viewport, not as pixels. A phone rotated from
 * portrait to landscape, or a desktop window resized, would otherwise leave the
 * button off-screen at coordinates that made sense on a different screen —
 * which is worse than not remembering at all, because it is unreachable and
 * looks like the feature has disappeared.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readPreference, writePreference } from "@/lib/preference";

const KEY = "launcher.pos";
/** Movement under this is a tap — the button opens rather than moves. */
const TAP_SLOP_PX = 8;
/** Keep the whole button on screen whatever the stored fraction says. */
const MARGIN = 8;

export type LauncherPosition = { readonly xf: number; readonly yf: number } | null;

export type DraggableLauncher = {
  /** Attach to the button, so its size can be measured for the clamp. */
  readonly ref: React.RefObject<HTMLButtonElement | null>;
  /** Spread onto the button. */
  readonly handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  };
  /** `null` until a position is stored, so CSS keeps the default corner. */
  readonly style: React.CSSProperties | undefined;
  readonly dragging: boolean;
  /** True when the gesture that just ended was a tap, so the caller may open. */
  wasTap: () => boolean;
  reset: () => void;
};

export function useDraggableLauncher(): DraggableLauncher {
  const [pos, setPos] = useState<LauncherPosition>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x0: number; y0: number; moved: number } | null>(null);
  const tapRef = useRef(true);
  const elRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setPos(readPreference<LauncherPosition>(KEY, null)); }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    // Capture keeps the drag alive when the pointer leaves the button, which it
    // does immediately — the button is small and the finger is not. Guarded
    // because it THROWS for a pointer id the browser does not know about, and an
    // uncaught throw here abandons the gesture before it starts.
    try { el.setPointerCapture(e.pointerId); } catch { /* drag still works, just not outside the button */ }
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: 0 };
    tapRef.current = true;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    if (d.moved < TAP_SLOP_PX) return;

    tapRef.current = false;
    setDragging(true);
    const el = e.currentTarget;
    const w = el.offsetWidth, h = el.offsetHeight;
    // Clamped to the viewport as it moves, not only when it lands: a button
    // that can be dragged off the edge and then springs back reads as a bug.
    const x = Math.min(Math.max(e.clientX - w / 2, MARGIN), window.innerWidth - w - MARGIN);
    const y = Math.min(Math.max(e.clientY - h / 2, MARGIN), window.innerHeight - h - MARGIN);
    setPos({ xf: x / window.innerWidth, yf: y / window.innerHeight });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* never captured */ }
    if (d.moved >= TAP_SLOP_PX) {
      setDragging(false);
      setPos((p) => { if (p) writePreference(KEY, p); return p; });
    }
  }, []);

  const reset = useCallback(() => { setPos(null); writePreference(KEY, null); }, []);

  /**
   * The clamped pixel position for the current viewport.
   *
   * Computed in JS rather than with a CSS clamp, because the obvious CSS is
   * silently wrong: in `left: clamp(8px, 57vw, calc(100vw - 100% - 8px))` the
   * `100%` resolves against the CONTAINING BLOCK, not the element. For a fixed
   * element the containing block is the viewport, so the maximum evaluates to
   * `-8px`, falls below the minimum, and clamp returns the minimum — pinning
   * the button to the top-left corner whatever was stored. Measured: a stored
   * fraction of 0.58 rendered at left:8px.
   *
   * The element's own width is only knowable at runtime, so the clamp is done
   * where that is known.
   */
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setBox({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // A rotation changes the viewport, not the button, so ResizeObserver alone
    // would leave a landscape position computed from portrait bounds.
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const placed = pos && box.w > 0 && typeof window !== "undefined"
    ? {
        left: Math.min(Math.max(pos.xf * window.innerWidth, MARGIN), Math.max(MARGIN, window.innerWidth - box.w - MARGIN)),
        top: Math.min(Math.max(pos.yf * window.innerHeight, MARGIN), Math.max(MARGIN, window.innerHeight - box.h - MARGIN)),
      }
    : null;

  return {
    ref: elRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
    style: placed
      ? { left: `${placed.left}px`, top: `${placed.top}px`, right: "auto", bottom: "auto", touchAction: "none" }
      : undefined,
    dragging,
    wasTap: () => tapRef.current,
    reset,
  };
}
