import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/sites";

/**
 * The install manifest.
 *
 * `SITE_NAME` comes from lib/sites — safe here because this is a route handler
 * that runs on the SERVER at build time, not a client component. The corpus
 * never reaches the browser through it.
 *
 * `display: "standalone"` because the atlas is a full-screen map with its own
 * header; a browser chrome bar on top of it wastes the vertical space the
 * timeline needs, which is the row that was already falling off short screens.
 *
 * `orientation` is deliberately unset. A map is as usable in landscape as in
 * portrait, and locking it would take a choice away from someone holding a
 * phone one-handed on a temple step.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — the sacred geography of the Indic world`,
    short_name: "Tirtha Atlas",
    description:
      "A cited, dated, cross-tradition atlas of temples and sacred sites. Works offline once opened.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Matches --bg in globals.css. The splash screen is the first thing an
    // installed app shows, and a white flash before a parchment page reads as a
    // broken launch.
    background_color: "#EFEBE2",
    theme_color: "#EFEBE2",
    categories: ["travel", "education", "reference"],
    lang: "en-IN",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Search the gazetteer", url: "/sites" },
      { name: "Pilgrimage circuits", url: "/circuits" },
    ],
  };
}
