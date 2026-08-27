import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { SITES, ERAS, getSite, eraOf } from "@/lib/sites";

export const alt = "Tirtha Atlas — site card with era, place and date";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Prerender one card per site, exactly as page.tsx prerenders one page per site. */
export function generateStaticParams() {
  return SITES.map((s) => ({ slug: s.id }));
}

/**
 * Era palette, dark scheme, mirrored from `--e1`…`--e6` in src/app/globals.css.
 *
 * This runtime renders outside the document, so it cannot read CSS variables —
 * the six values have to be duplicated here. They are the colour-blind-validated
 * dark-scheme set, which is the one that belongs on this card's dark ground.
 * Constitution rule 7: change them only together with globals.css.
 */
const ERA_COLORS = ["#BE8A2E", "#4487CC", "#AC4C34", "#35A084", "#7B5BC8", "#C9679B"] as const;

/** Shell tokens, likewise mirrored from the dark scheme in globals.css. */
const BG = "#131722";
const INK = "#EAE3D3";
const INK2 = "#A9A190";
const MUT = "#7C7666";
const GOLD = "#D9A441";

/**
 * Marcellus is loaded through next/font in the document and is not available to
 * this renderer, so the card names a serif stack and degrades to the renderer's
 * bundled default rather than shipping a second copy of the font.
 */
const SERIF = 'Georgia, "Times New Roman", Times, serif';

const NAME_SIZE = { long: 56, medium: 68, short: 82 } as const;

const nameSize = (name: string): number =>
  name.length > 38 ? NAME_SIZE.long : name.length > 26 ? NAME_SIZE.medium : NAME_SIZE.short;

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = getSite(slug);
  if (!s) notFound();

  const era = eraOf(s);
  // eraOf returns -1 for a year past the last boundary; fall back to the gold
  // accent rather than indexing off the end of the palette.
  const accent = ERA_COLORS[era] ?? GOLD;
  const eraName = ERAS[era]?.name ?? "Undated";
  const where = [s.place, s.state, s.country].filter(Boolean).join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: BG,
          color: INK,
          fontFamily: SERIF,
        }}
      >
        {/* era rule down the leading edge */}
        <div style={{ display: "flex", flex: 1 }}>
          <div style={{ display: "flex", width: 16, backgroundColor: accent }} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "space-between",
              padding: "58px 72px 50px 70px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 21,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              <div style={{ display: "flex", color: GOLD }}>Tirtha Atlas</div>
              <div style={{ display: "flex", color: accent }}>
                {eraName} · {s.tradition}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: nameSize(s.name), lineHeight: 1.08, color: INK }}>{s.name}</div>
              <div style={{ display: "flex", marginTop: 24, fontSize: 30, color: INK2 }}>{where}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", fontSize: 26 }}>
              <div style={{ display: "flex", color: INK }}>{s.builtDisplay}</div>
              <div style={{ display: "flex", color: MUT, padding: "0 14px" }}>·</div>
              <div style={{ display: "flex", color: INK2 }}>{s.dynasty}</div>
            </div>
          </div>
        </div>

        {/* the six eras as a band; this site's era is the lit one */}
        <div style={{ display: "flex", height: 16 }}>
          {ERA_COLORS.map((color, i) => (
            <div key={color} style={{ display: "flex", flex: 1, backgroundColor: color, opacity: i === era ? 1 : 0.2 }} />
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
