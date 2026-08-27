"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SITES, GEO, ERAS, eraOf, appearYear, fmtYear, gmapsUrl, headerStats, type Site } from "@/lib/sites";
import SiteHeader from "./SiteHeader";

const { W, H, LON0, LON1, LAT0, LAT1 } = GEO;
const mercY = (t: number) => Math.log(Math.tan(Math.PI / 4 + (t * Math.PI) / 180 / 2));
const YT = mercY(LAT1), YB = mercY(LAT0);
const PX = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * W;
const PY = (lat: number) => ((YT - mercY(lat)) / (YT - YB)) * H;
const TRADS: Record<string, string> = { Hindu: "circle", Buddhist: "square", Jain: "diamond", Sikh: "triangle" };
const YEAR_MIN = -650, YEAR_MAX = 2030;
const STATS = headerStats();

function eraColor(i: number) {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(`--e${i + 1}`).trim();
}
function shapePath(kind: string, r: number) {
  if (kind === "square") { const a = r * 0.9; return `M${-a} ${-a}H${a}V${a}H${-a}Z`; }
  if (kind === "diamond") { const a = r * 1.25; return `M0 ${-a}L${a} 0L0 ${a}L${-a} 0Z`; }
  if (kind === "triangle") { const a = r * 1.3; return `M0 ${-a}L${a * 0.9} ${a * 0.75}L${-a * 0.9} ${a * 0.75}Z`; }
  return "";
}

type Filters = { q: string; country: string; trad: string; dyn: string; cir: string };
const EMPTY: Filters = { q: "", country: "", trad: "", dyn: "", cir: "" };

function visible(s: Site, f: Filters, year: number) {
  if (appearYear(s) > year) return false;
  if (f.country && s.country !== f.country) return false;
  if (f.trad && s.tradition !== f.trad) return false;
  if (f.dyn && s.dynasty !== f.dyn) return false;
  if (f.cir && !(s.circuits ?? []).includes(f.cir)) return false;
  if (f.q) {
    const hay = `${s.name} ${s.alt ?? ""} ${s.place} ${s.state ?? ""} ${s.country} ${s.deity} ${s.dynasty}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

export default function AtlasClient() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [year, setYear] = useState(YEAR_MAX);
  const [sel, setSel] = useState<string | null>(null);
  const [index, setIndex] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [shownCount, setShownCount] = useState(SITES.length);
  const [fOpen, setFOpen] = useState(false);

  // Opening the index always clears the site panel — they share the one side rail.
  const toggleIndex = useCallback(() => { setIndex((v) => !v); setSel(null); }, []);

  const mapRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const ptsRef = useRef<SVGGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<SVGSVGElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const marks = useRef(new Map<string, { g: SVGGElement; mark: SVGElement; halo: SVGCircleElement; kind: string }>());
  const yearRef = useRef(year); yearRef.current = year;
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const selRef = useRef(sel); selRef.current = sel;

  const lists = useMemo(() => ({
    countries: [...new Set(SITES.map((s) => s.country))].sort(),
    trads: [...new Set(SITES.map((s) => s.tradition))].sort(),
    dyns: [...new Set(SITES.map((s) => s.dynasty))].sort(),
    cirs: [...new Set(SITES.flatMap((s) => s.circuits ?? []))].sort(),
  }), []);

  const applyView = () => {
    const { x, y, k } = view.current;
    worldRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
    renderPoints();
  };

  function renderPoints() {
    const k = view.current.k, r = Math.max(4.6 / k, 1.6), sw = 1.1 / k;
    let shown = 0;
    for (const s of SITES) {
      const m = marks.current.get(s.id); if (!m) continue;
      const vis = visible(s, filtersRef.current, yearRef.current);
      m.g.style.display = vis ? "" : "none";
      if (!vis) continue;
      shown++;
      const builtYet = s.built[0] <= yearRef.current;
      const col = eraColor(eraOf(s));
      if (m.kind === "circle") (m.mark as SVGCircleElement).setAttribute("r", String(r));
      else m.mark.setAttribute("d", shapePath(m.kind, r));
      m.mark.setAttribute("fill", builtYet ? col : "none");
      m.mark.setAttribute("stroke", builtYet ? "var(--bg)" : col);
      m.mark.setAttribute("stroke-width", String(builtYet ? sw : sw * 1.6));
      m.halo.setAttribute("r", String(r * 2.1));
      m.halo.setAttribute("stroke", col);
      m.halo.setAttribute("stroke-width", String(sw * 1.4));
      m.g.classList.toggle("sel", selRef.current === s.id);
    }
    setShownCount(shown);
  }

  // build points once
  useEffect(() => {
    const ptsG = ptsRef.current!; ptsG.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    for (const s of SITES) {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "pt");
      g.setAttribute("transform", `translate(${PX(s.lng).toFixed(1)} ${PY(s.lat).toFixed(1)})`);
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("class", "halo"); halo.setAttribute("fill", "none");
      const kind = TRADS[s.tradition] ?? "circle";
      const mark = document.createElementNS(NS, kind === "circle" ? "circle" : "path");
      g.appendChild(halo); g.appendChild(mark);
      g.addEventListener("click", (e) => { e.stopPropagation(); select(s.id, false); });
      g.addEventListener("mouseenter", (e) => showTip(s, e as MouseEvent));
      g.addEventListener("mousemove", (e) => moveTip(e as MouseEvent));
      g.addEventListener("mouseleave", hideTip);
      ptsG.appendChild(g);
      marks.current.set(s.id, { g, mark, halo, kind });
    }
    renderPoints();
    // opening sweep
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      let y = YEAR_MIN;
      const t = setTimeout(() => {
        setYear(YEAR_MIN);
        const iv = setInterval(() => { y += 28; if (y >= YEAR_MAX) { y = YEAR_MAX; clearInterval(iv); } setYear(y); }, 26);
      }, 450);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { renderPoints(); drawTimeline(); }, [filters, year, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // pan / zoom
  useEffect(() => {
    const map = mapRef.current!;
    const svgPoint = (e: { clientX: number; clientY: number }) => {
      const r = map.getBoundingClientRect();
      const sx = Math.max(W / r.width, H / r.height);
      const ox = (r.width - W / sx) / 2, oy = (r.height - H / sx) / 2;
      return [(e.clientX - r.left - ox) * sx, (e.clientY - r.top - oy) * sx] as const;
    };
    const zoomAt = (px: number, py: number, f: number) => {
      const v = view.current; const k2 = Math.min(24, Math.max(1, v.k * f));
      const fx = (px - v.x) / v.k, fy = (py - v.y) / v.k;
      v.x = px - fx * k2; v.y = py - fy * k2; v.k = k2;
      if (k2 === 1) { v.x = 0; v.y = 0; }
      applyView();
    };
    (map as unknown as { _zoomAt: typeof zoomAt })._zoomAt = zoomAt;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const [px, py] = svgPoint(e); zoomAt(px, py, e.deltaY < 0 ? 1.25 : 0.8); };
    map.addEventListener("wheel", onWheel, { passive: false });
    let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false }; map.setPointerCapture(e.pointerId); map.classList.add("drag"); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const r = map.getBoundingClientRect(); const sx = Math.max(W / r.width, H / r.height);
      const dx = (e.clientX - drag.x) * sx, dy = (e.clientY - drag.y) * sx;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.current.x = drag.vx + dx; view.current.y = drag.vy + dy; applyView();
    };
    const up = (e: PointerEvent) => { if (drag && !drag.moved && e.target === map) select(null, false); drag = null; map.classList.remove("drag"); };
    map.addEventListener("pointerdown", down); map.addEventListener("pointermove", move); map.addEventListener("pointerup", up);
    return () => { map.removeEventListener("wheel", onWheel); map.removeEventListener("pointerdown", down); map.removeEventListener("pointermove", move); map.removeEventListener("pointerup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomCenter = (f: number) => (mapRef.current as unknown as { _zoomAt: (x: number, y: number, f: number) => void })._zoomAt(W / 2, H / 2, f);
  const resetView = () => { view.current = { x: 0, y: 0, k: 1 }; applyView(); };
  const flyTo = (s: Site) => { const k = Math.max(view.current.k, 4.5); view.current = { k, x: W / 2 - PX(s.lng) * k, y: H * 0.42 - PY(s.lat) * k }; applyView(); };

  function select(id: string | null, fly = true) {
    setSel(id); setIndex(false);
    if (id) { const s = SITES.find((x) => x.id === id)!; if (fly) flyTo(s); }
    // shareable deep link: /#site=<id>
    try { history.replaceState(null, "", id ? `#site=${id}` : window.location.pathname); } catch { /* no-op */ }
  }

  // open a site from the URL hash on load (e.g. /#site=angkor-wat)
  useEffect(() => {
    const m = window.location.hash.match(/^#site=([a-z0-9-]+)$/);
    if (m && SITES.some((s) => s.id === m[1])) {
      const t = setTimeout(() => select(m[1], true), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tooltip
  function showTip(s: Site, e: MouseEvent) {
    const tip = tipRef.current!;
    tip.innerHTML = `<div class="tn">${s.name}</div><div class="tm">${s.place} · ${s.country}</div><div class="ty" style="color:${eraColor(eraOf(s))}">${s.builtDisplay}</div>`;
    tip.style.opacity = "1"; moveTip(e);
  }
  function moveTip(e: MouseEvent) {
    const tip = tipRef.current!, r = wrapRef.current!.getBoundingClientRect();
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 10;
    if (x > r.width - 250) x -= 270; if (y > r.height - 90) y -= 80;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }
  function hideTip() { if (tipRef.current) tipRef.current.style.opacity = "0"; }

  // timeline
  function drawTimeline() {
    const svg = tlRef.current; if (!svg) return;
    const w = svg.getBoundingClientRect().width || 800, h = 64;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const x = (y: number) => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * w;
    const BIN = 50; const bins: Record<number, number> = {};
    for (const s of SITES) { const b = Math.floor(s.built[0] / BIN) * BIN; bins[b] = (bins[b] ?? 0) + 1; }
    const max = Math.max(...Object.values(bins));
    let bars = "";
    for (const [bs, n] of Object.entries(bins)) {
      const b = +bs; const bh = Math.max(2, (n / max) * 34);
      bars += `<rect x="${x(b) + 0.5}" y="${44 - bh}" width="${Math.max(2, x(b + BIN) - x(b) - 1.5)}" height="${bh}" rx="1.5" fill="var(--e${eraOf({ built: [b + BIN / 2, 0] } as Site) + 1})" opacity="${b + BIN / 2 <= yearRef.current ? 1 : 0.22}"/>`;
    }
    let bands = "", labels = ""; let prev = YEAR_MIN;
    ERAS.forEach((e, i) => {
      const to = Math.min(e.to, YEAR_MAX);
      bands += `<rect x="${x(prev)}" y="46" width="${x(to) - x(prev)}" height="6" fill="var(--e${i + 1})" opacity=".55" rx="1"/>`;
      if (x(to) - x(prev) > 70) labels += `<text x="${(x(prev) + x(to)) / 2}" y="61" text-anchor="middle" font-size="8.5" letter-spacing="1.5" fill="var(--mut)" style="font-family:var(--font-mono),monospace">${e.name.toUpperCase()}</text>`;
      prev = to;
    });
    const cx = x(Math.min(yearRef.current, YEAR_MAX));
    const ticks = [-500, 1, 500, 1000, 1500, 2000].map((t) => `<text x="${x(t)}" y="9" text-anchor="middle" font-size="8" fill="var(--mut)" style="font-family:var(--font-mono),monospace">${t < 0 ? `${Math.abs(t)}BCE` : t === 1 ? "1CE" : t}</text>`).join("");
    svg.innerHTML = `${ticks}${bars}${bands}${labels}<line x1="${cx}" y1="4" x2="${cx}" y2="52" stroke="var(--gold)" stroke-width="1.2"/>`;
  }
  useEffect(() => {
    const onR = () => drawTimeline();
    addEventListener("resize", onR); return () => removeEventListener("resize", onR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // play
  useEffect(() => {
    if (!playing) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setYear(YEAR_MAX); setPlaying(false); return; }
    if (yearRef.current >= YEAR_MAX) setYear(YEAR_MIN);
    const iv = setInterval(() => {
      setYear((y) => { const n = y + 12; if (n >= YEAR_MAX) { clearInterval(iv); setPlaying(false); return YEAR_MAX; } return n; });
    }, 40);
    return () => clearInterval(iv);
  }, [playing]);

  const selected = sel ? SITES.find((s) => s.id === sel)! : null;
  const visList = SITES.filter((s) => visible(s, filters, year));
  const shapes: Record<string, string> = {
    circle: '<circle cx="5.5" cy="5.5" r="4.6"/>', square: '<rect x="1.4" y="1.4" width="8.2" height="8.2"/>',
    diamond: '<path d="M5.5 0L11 5.5L5.5 11L0 5.5Z"/>', triangle: '<path d="M5.5 0.4L10.8 10.2H0.2Z"/>',
  };

  return (
    <>
      <SiteHeader stats={STATS} indexOpen={index} onIndexToggle={toggleIndex} />

      <div className="filters">
        <input type="search" placeholder="Search temples, deities, places…" aria-label="Search" value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <button className={`ftoggle ${fOpen ? "on" : ""}`} onClick={() => setFOpen(!fOpen)} aria-expanded={fOpen} aria-controls="fwrap">
          Filters{(filters.country || filters.trad || filters.dyn || filters.cir) ? " ·" : ""} {fOpen ? "▴" : "▾"}
        </button>
        <div className={`fwrap ${fOpen ? "open" : ""}`} id="fwrap">
          <select aria-label="Country" value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value })}>
            <option value="">All countries</option>{lists.countries.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Tradition" value={filters.trad} onChange={(e) => setFilters({ ...filters, trad: e.target.value })}>
            <option value="">All traditions</option>{lists.trads.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Dynasty" value={filters.dyn} onChange={(e) => setFilters({ ...filters, dyn: e.target.value })}>
            <option value="">All dynasties</option>{lists.dyns.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Circuit" value={filters.cir} onChange={(e) => setFilters({ ...filters, cir: e.target.value })}>
            <option value="">All circuits</option>{lists.cirs.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="reset" onClick={() => setFilters(EMPTY)}>reset</button>
        </div>
        <span className="count"><b>{shownCount}</b> of {SITES.length} sites shown</span>
      </div>

      <div className="main">
        <div className="mapwrap" ref={wrapRef}>
          <svg ref={mapRef} className="map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
            aria-label="Map of South and Southeast Asia with sacred sites (boundaries as per Government of India)">
            <g ref={worldRef}>
              <g dangerouslySetInnerHTML={{ __html: GEO.svgInner }} />
              <g ref={ptsRef} />
            </g>
          </svg>
          <div className="maptools">
            <button aria-label="Zoom in" onClick={() => zoomCenter(1.5)}>+</button>
            <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.5)}>−</button>
            <button aria-label="Reset view" style={{ fontSize: 12 }} onClick={resetView}>⌂</button>
          </div>
          <div className="maplegend">
            {ERAS.map((e, i) => <span className="li" key={e.name}><span className="dot" style={{ background: `var(--e${i + 1})` }} />{e.name}</span>)}
            <span className="li" style={{ opacity: 0.8 }}>○ sacred, pre-structure</span>
          </div>
          <div className="tip" ref={tipRef} role="status" />
        </div>

        <aside className={`side ${sel || index ? "open" : ""}`}>
          {selected ? (
            <div className="pan">
              <span className="crumb" onClick={() => select(null, false)}>← all sites</span>
              <div className="eyebrow" style={{ color: eraColor(eraOf(selected)) }}>{ERAS[eraOf(selected)].name} · {selected.country}</div>
              <h2 className="site">{selected.name}</h2>
              {selected.native && <div className="native">{selected.native}</div>}
              <div className="where">{selected.place}{selected.state ? `, ${selected.state}` : ""} · <span className="mono" style={{ fontSize: 11 }}>{selected.lat.toFixed(4)}°, {selected.lng.toFixed(4)}°</span></div>
              <div className="chips">
                {[selected.tradition, selected.dynasty, selected.style].map((c) => <span className="chip" key={c}>{c}</span>)}
                {(selected.circuits ?? []).map((c) => <span className="chip gold" key={c}>{c}</span>)}
              </div>
              <div className="dates">
                <div><div className="dl">Sacred since</div><div className="dv">{fmtYear(appearYear(selected))}</div><div className="ds">{selected.originNote ?? "first attestation / structure"}</div></div>
                <div><div className="dl">Standing structure</div><div className="dv">{selected.builtDisplay}</div><div className="ds">{selected.patron ? `patron: ${selected.patron}` : selected.dynasty}</div></div>
              </div>
              <div className="sect"><h3>Deity & significance</h3><p><b>{selected.deity}.</b> {selected.significance}</p></div>
              {selected.story && <div className="sect katha"><h3>Sthala katha · legend</h3><p>{selected.story}</p></div>}
              {selected.access && <div className="sect"><h3>Reaching there</h3><p className="practical">{selected.access}</p></div>}
              <div className="actions">
                <Link className="primary" href={`/site/${selected.id}`}>Full entry →</Link>
                {selected.website && <a href={selected.website} target="_blank" rel="noopener noreferrer">Official site ↗</a>}
                <a href={gmapsUrl(selected)} target="_blank" rel="noopener noreferrer">Google Maps ↗</a>
                {selected.wiki && <a href={selected.wiki} target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>}
              </div>
              {selected.phone && <p className="practical mono" style={{ marginTop: 6 }}>☏ {selected.phone}</p>}
              <div className="srcs">
                <h3 style={{ fontFamily: "var(--font-mono),monospace", fontSize: 10, letterSpacing: ".18em", color: "var(--mut)", textTransform: "uppercase", marginBottom: 2 }}>Sources</h3>
                <ul>{selected.sources.map((x) => <li key={x.u}><a href={x.u} target="_blank" rel="noopener noreferrer">{x.l}</a></li>)}</ul>
                <div className="vnote">coords: {selected.verified ?? "curated"} · retrieved 2026-08-26</div>
              </div>
            </div>
          ) : index ? (
            <div className="pan ix">
              <div className="eyebrow">Index</div>
              <h2 className="site" style={{ fontSize: 21 }}>Gazetteer — {visList.length} sites</h2>
              {[...new Set(visList.map((s) => s.country))].sort().map((c) => (
                <div key={c}>
                  <h4>{c} · {visList.filter((s) => s.country === c).length}</h4>
                  {visList.filter((s) => s.country === c).sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                    <div className="ixrow" key={s.id} onClick={() => select(s.id)}>
                      <span className="d" style={{ background: eraColor(eraOf(s)) }} />
                      <span className="nm">{s.name}</span>
                      <span className="yr">{fmtYear(s.built[0])}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="pan ov">
              <div className="eyebrow">The Atlas</div>
              <h2 className="site" style={{ fontSize: 21 }}>Twenty-six centuries of sacred building</h2>
              <p className="lead">Scrub the timeline to watch temples rise from Mauryan stupas to the newest mandirs — or click any mark for history, legend, pilgrim routes, and full citations. Colour is the era of the standing structure; shape is the tradition.</p>
              <div className="statgrid">
                <div className="stat"><b>{SITES.length}</b><span>sites</span></div>
                <div className="stat"><b>{new Set(SITES.map((s) => s.country)).size}</b><span>countries</span></div>
                <div className="stat"><b>{SITES.filter((s) => (s.status ?? []).includes("UNESCO") || (s.circuits ?? []).some((c) => c.includes("UNESCO"))).length}</b><span>UNESCO</span></div>
              </div>
              <div className="sect"><h3>Construction era</h3>
                <div className="leg">
                  {ERAS.map((e, i) => (
                    <div key={e.name}>
                      <div className="li"><span className="dot" style={{ background: `var(--e${i + 1})` }} /><span>{e.name}</span>
                        <span className="yr">{i === 0 ? "to 550 CE" : `${fmtYear(ERAS[i - 1].to)} – ${e.to === 2031 ? "today" : fmtYear(e.to)}`}</span></div>
                      <div className="note">{e.note}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sect"><h3>Tradition (shape)</h3>
                <div className="leg tradleg">
                  {Object.entries(TRADS).map(([t, k]) => (
                    <div className="li" key={t}><svg className="shape" viewBox="0 0 11 11" style={{ fill: "var(--ink2)" }} dangerouslySetInnerHTML={{ __html: shapes[k] }} />{t}</div>
                  ))}
                </div>
              </div>
              <div className="sect"><h3>While time-scrubbing</h3><p style={{ fontSize: 12.5, color: "var(--ink2)" }}>A hollow mark = site already sacred, today&apos;s structure not yet raised. It fills the year construction begins.</p></div>
            </div>
          )}
        </aside>
      </div>

      <div className="timeline">
        <div className="tl-top">
          <button className="play" aria-label={playing ? "Pause timeline" : "Play timeline"} onClick={() => setPlaying(!playing)}>{playing ? "⏸" : "▶"}</button>
          <div className="yearbox"><small>YEAR</small><span>{fmtYear(year === YEAR_MAX ? 2026 : year)}</span></div>
          <div className="tlsvgwrap">
            <svg ref={tlRef} aria-hidden="true" />
            <input type="range" min={YEAR_MIN} max={YEAR_MAX} step={5} value={Math.min(year, YEAR_MAX)} aria-label="Timeline year"
              onChange={(e) => { setPlaying(false); setYear(+e.target.value); }} />
          </div>
          <button className="showall" onClick={() => { setPlaying(false); setYear(YEAR_MAX); }}>show all eras</button>
        </div>
      </div>
    </>
  );
}

