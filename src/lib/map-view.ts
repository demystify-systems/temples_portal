/**
 * Where the map opens.
 *
 * The atlas frames the whole Indic world — 58°E to 132°E, Gujarat to Java. On a
 * desktop that reads as the point being made: this is a region, not a country.
 * On a phone it reads as a mistake. The viewBox is 1.3× wider than it is tall,
 * so a narrow screen fits it by width and spends most of its height on empty
 * ocean, with the subcontinent a thumbnail in the middle.
 *
 * So phones open on India. Not a different map — the same one, already scrolled
 * to where all but a fraction of the records are, which is what someone opening
 * an atlas on a phone was going to do first anyway.
 *
 * The framing reuses `viewForBounds`, the same function a cluster tap uses to
 * zoom to its members. One implementation of "fit these bounds" rather than a
 * second one that drifts from it.
 */

import { MAP_BOX } from "./generated/map-projection.ts";
import { INDIA_BOUNDS, boundsToRect } from "./layers.ts";
import { viewForBounds } from "./cluster.ts";
import { MIN_ZOOM, type Extent, type View } from "./map-gestures.ts";

/**
 * Breathing room around the subcontinent, as a fraction of its size.
 *
 * Tighter than the cluster default. The zoom this yields is capped by geometry
 * rather than by taste: India is taller than it is wide (596 x 679 content
 * units) and the viewBox is wider than it is tall, so fitting the whole country
 * is height-limited whatever the padding. 0.15 gives k ~1.46; 0.34 gave 1.25;
 * neither can go further without cutting off Kashmir or Kanyakumari.
 */
export const NARROW_PADDING = 0.15;

/** The world view, unchanged: the atlas's own subject is the whole region. */
const WORLD: View = { x: 0, y: 0, k: MIN_ZOOM };

export const initialView = (extent: Extent, narrow: boolean): View => {
  if (!narrow) return WORLD;

  const r = boundsToRect(MAP_BOX, INDIA_BOUNDS);
  return viewForBounds(
    { minX: r.x, maxX: r.x + r.width, minY: r.y, maxY: r.y + r.height },
    extent,
    NARROW_PADDING,
  );
};
