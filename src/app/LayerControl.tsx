"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  DISTRICT_NOTE, MAP_LAYERS, activeAttributions, activeTermsNotes, layerStatusText,
  type LayerStatus, type MapLayer,
} from "@/lib/layers";

/**
 * The "manage layers" panel.
 *
 * It renders `MAP_LAYERS` and nothing else: there is no per-layer markup here,
 * so adding a layer to the registry adds a row to this panel with no edit to
 * this file. That is the whole point of the registry.
 *
 * Two things it is obliged to do, not free to style away:
 *  - Show the service attribution for every layer that is on, whether or not
 *    the panel is open. That is a condition of using the service.
 *  - Show, in plain words, that Bhuvan's terms of use could not be pinned.
 *    Neither claim is hidden behind a tooltip or a hover.
 */

type Props = {
  /** Which layers are on, keyed by layer id. */
  readonly on: Readonly<Record<string, boolean>>;
  readonly onToggle: (id: string, next: boolean) => void;
  /** Per-layer fetch state, for the remote layers. */
  readonly status: Readonly<Record<string, LayerStatus>>;
};

const LayersIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <path d="M8 1.6 14.6 5 8 8.4 1.4 5Z" />
    <path d="m1.4 8.4 6.6 3.4 6.6-3.4" />
    <path d="m1.4 11.6 6.6 3.4 6.6-3.4" />
  </svg>
);

export default function LayerControl({ on, onToggle, status }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Escape closes and hands focus back to the button it came from. Bound to the
  // panel, not the document, so it can never swallow the map's own Escape.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close(true);
  };

  // A click anywhere else closes it, and so does Escape from outside the panel.
  // Both are registered only while open, so the map pays nothing for a panel
  // nobody has opened.
  //
  // The document-level Escape is not redundant with `onPanelKeyDown`: WebKit
  // does not move focus to a checkbox when it is clicked, so a reader who has
  // just ticked a layer on Safari has focus on the body and nothing inside the
  // panel would ever see the key. When focus *is* inside, the panel's own
  // handler runs first and stops propagation, so this never fires twice.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (panelRef.current?.contains(t) || toggleRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const credits = activeAttributions(on);
  const termsNotes = activeTermsNotes(on);
  const liveCount = MAP_LAYERS.filter((l) => l.source.kind === "wms" && on[l.id]).length;

  return (
    <>
      <div className="layerctl">
        <button
          ref={toggleRef}
          type="button"
          className={`layerbtn ${open ? "on" : ""}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <LayersIcon />
          <span>Layers</span>
          {liveCount > 0 && <span className="layercount" aria-hidden="true">{liveCount}</span>}
        </button>

        {open && (
          <div
            ref={panelRef}
            id={panelId}
            className="layerpanel"
            role="group"
            aria-label="Map layers"
            onKeyDown={onPanelKeyDown}
          >
            <div className="layerhead">
              <span>Map layers</span>
              <button type="button" className="layerclose" onClick={() => close(true)}
                aria-label="Close layers panel">×</button>
            </div>

            <ul className="layerlist">
              {MAP_LAYERS.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  checked={!!on[layer.id]}
                  // Only a remote layer has a fetch to report. A builtin one is
                  // simply drawn, so it gets no status line at all.
                  status={
                    layer.source.kind === "wms" && on[layer.id]
                      ? (status[layer.id] ?? "loading")
                      : "off"
                  }
                  onToggle={onToggle}
                />
              ))}
            </ul>

            {/* Terms before the districts footnote: it is a claim about someone
                else's rights and must not sit below an aside about a missing
                feature. */}
            {termsNotes.map((note) => (
              <p className="layerterms" key={note}>{note}</p>
            ))}

            <p className="layerfoot">{DISTRICT_NOTE}</p>
          </div>
        )}
      </div>

      {/* Attribution lives outside the panel: it must stay on screen while a
          layer is on, whether or not anyone has the panel open. */}
      {credits.length > 0 && (
        <div className="layercredit">
          {credits.map((c) => <span key={c}>{c}</span>)}
        </div>
      )}
    </>
  );
}

function LayerRow({
  layer, checked, status, onToggle,
}: {
  readonly layer: MapLayer;
  readonly checked: boolean;
  readonly status: LayerStatus;
  readonly onToggle: (id: string, next: boolean) => void;
}) {
  const statusText = layerStatusText(status);
  const isLive = layer.source.kind === "wms";
  return (
    <li className="layerrow">
      <label className="layerlabel">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(layer.id, e.target.checked)}
        />
        <span className="layertext">
          <span className="layername">
            {layer.label}
            {isLive && <span className="layerlive" title="Fetched live from a remote service">live</span>}
          </span>
          <span className="layerblurb">{layer.blurb}</span>
        </span>
      </label>
      {/* Coverage is stated whenever the layer is on: a reader must never be
          left to infer that a country with no state lines drawn has no states. */}
      {checked && layer.coverageNote && <p className="layernote">{layer.coverageNote}</p>}
      {/* Credits that are not painted on the map are shown here instead, so
          every source that is on is credited exactly once, somewhere visible. */}
      {checked && layer.attribution && !layer.attributionOnMap && (
        <p className="layerattr">{layer.attribution}</p>
      )}
      {checked && statusText && (
        <p className={`layerstatus s-${status}`} role="status">{statusText}</p>
      )}
    </li>
  );
}
