import geo from "../../data/geo.json";
import AtlasClient from "./AtlasClient";

/**
 * The atlas page.
 *
 * This is a SERVER component, and the one line that matters is the `outlines`
 * prop. `data/geo.json` is 376 kB, of which 385 kB of string is `svgInner` —
 * the country outlines. AtlasClient used to import that file directly, so 136.7
 * kB gzipped of static SVG markup was bundled into the client chunk and
 * re-downloaded by every visitor.
 *
 * The outlines never change between deploys and nothing interactive reads them:
 * they are markup, not data. Rendering them here puts them in the initial HTML,
 * where they are gzipped once by the CDN alongside everything else, and the
 * client component receives them as a string it hands to one `<g>`.
 *
 * The boundaries themselves are the India point-of-view Natural Earth dataset
 * and may only ever be regenerated from an `*_admin_0_countries_ind` source
 * (CLAUDE.md rule 1, legal and non-negotiable).
 */
export default function Home() {
  return (
    <div className="app">
      <AtlasClient outlines={geo.svgInner} />
    </div>
  );
}
