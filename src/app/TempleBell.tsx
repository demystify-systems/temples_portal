/**
 * A temple ghanta, drawn rather than borrowed.
 *
 * WHY NOT THE USUAL BELL
 * ----------------------
 * The bell in every icon set is a Western handbell: a plain rounded dome with a
 * ball clapper, and — because notification badges hang off it everywhere — it
 * reads as "you have alerts", not "speak to someone". A temple bell is a
 * different object and looks it: a long concave-flared skirt, a heavy stepped
 * lip that rings when struck, mouldings banding the waist, and a cast crown
 * with a suspension loop. Those four things are what make it read as a ghanta
 * at 30 px, so they are what this draws.
 *
 * COLOUR
 * ------
 * Everything is `currentColor` through a gradient, so the bell takes the
 * launcher's gold in both themes and needs no palette of its own. The single
 * white highlight is the one exception: it is specular, and brass catches light
 * the same way on either ground.
 *
 * MOTION
 * ------
 * The body and the clapper are separate groups pivoting on the same point at
 * the loop. The clapper swings wider and starts fractionally later, which is
 * what makes a hanging bell look weighted rather than like a rotating picture.
 * Both stop dead under `prefers-reduced-motion` — see globals.css.
 */
export function TempleBell() {
  return (
    <svg className="bell" viewBox="0 0 48 56" width="30" height="35" aria-hidden="true" focusable="false">
      <defs>
        {/* Brass, from the inherited gold: lit on the left, shadowed right. */}
        <linearGradient id="bellbrass" x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.92" />
          <stop offset="0.42" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.66" />
        </linearGradient>
      </defs>

      <g className="bellbody" fill="url(#bellbrass)">
        {/* Suspension ring, drawn as a ring so the hook still reads at 30px. */}
        <path d="M24 1.6a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Zm0 2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
        {/* Cast crown: heavy and stepped, where a Western bell has a thin stem. */}
        <path d="M22.4 8.6h3.2c.8 0 1.4.5 1.6 1.2l1 2.6h-8.4l1-2.6c.2-.7.8-1.2 1.6-1.2Z" />
        {/*
         * The skirt, and the whole point of drawing this by hand. The sides are
         * CONCAVE — they draw in at the waist before flaring back out at the
         * mouth. A Western handbell is convex the entire way down. That one
         * difference is most of what separates the two silhouettes, and it is
         * still legible at icon size when the mouldings and highlight are not.
         */}
        <path d="M19.2 12.4c-2.6 2.4-3.6 6.4-4 11.2-.5 6-1.8 11-4.2 15.4h26c-2.4-4.4-3.7-9.4-4.2-15.4-.4-4.8-1.4-8.8-4-11.2Z" />
        {/* Waist mouldings, the cast bands a ghanta is ringed with. */}
        <path d="M15.4 24.9h17.2v1.6H15.4z" opacity="0.42" />
        <path d="M14.3 30.7h19.4v1.6H14.3z" opacity="0.42" />
        {/* The lip: proud of the skirt and stepped, where the bell is struck. */}
        <path d="M9.8 39h28.4c1.4 0 2.2 1.2 2.2 2.7s-1.2 2.8-2.8 2.8H10.4c-1.6 0-2.8-1.3-2.8-2.8S8.4 39 9.8 39Z" />
        {/* Specular highlight. Brass catches light the same way in either theme. */}
        <path d="M20.4 15.4c-1.8 2.2-2.5 5.4-2.8 9-.4 4.8-1.2 9-2.7 12.8" fill="none" stroke="#fff" strokeOpacity="0.26" strokeWidth="1.8" strokeLinecap="round" />
      </g>

      {/*
       * Only the part below the lip is drawn: inside the bell the clapper would
       * be hidden by the casting, and showing a rod through the body is the
       * detail that makes an icon look like a diagram of a bell.
       */}
      <g className="bellclapper" fill="url(#bellbrass)">
        <path d="M23.1 44.5h1.8v4.7h-1.8z" />
        <circle cx="24" cy="51.4" r="3.2" />
      </g>
    </svg>
  );
}
