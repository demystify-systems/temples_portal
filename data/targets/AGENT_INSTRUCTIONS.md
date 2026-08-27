# Record-builder instructions (read fully, follow exactly)

You are building verified database records for the Tirtha Atlas temple database.

INPUT: your batch file (JSON array of targets: {name, place, state, country, tradition, circuits, deity?, goddess?}).
SKIP LIST: `data/sites.json` itself — the live database, relative to the repo root. Grep it for the temple name AND for the place before researching a target; if it is clearly the same site, skip it (log as "duplicate"). A same-named temple in a DIFFERENT place or state is NOT a duplicate. (The old `existing_150.json` is a frozen snapshot of the first 150 records and is no longer the skip list.)

FOR EACH TARGET, using WebFetch ONLY (never bash/curl/python for any URL):
1. Fetch its English Wikipedia article: guess https://en.wikipedia.org/wiki/<Title> from the name; if that misses, use https://en.wikipedia.org/w/index.php?search=<name>+<place>. One retry with an alternate name is allowed.
2. From the article extract: decimal coordinates; presiding deity/dedication; construction period (century-level); dynasty/patron or era; architectural style if stated; official website ONLY if the article lists one; the resolved wiki URL.
   - If coordinates don't appear in the fetch, re-fetch the SAME article with a prompt asking specifically for the coordinates line; if still missing, WebSearch "<name> <place> coordinates" and use a Wikipedia-derived gazetteer (e.g. mapcarta/geohack) result.
   - NO COORDINATES FROM ANY SOURCE → SKIP the record (log "no-coords").
   - NO WIKIPEDIA ARTICLE AT ALL → SKIP (log "no-article"). No source, no record — never invent.
   - NO DEDICATION STATED ANYWHERE IN THE ARTICLE → SKIP (log "no-deity"). `deity` is required and may not be guessed. For a Buddhist monastery, a satra or a gurdwara the dedication the article names IS the answer (Shakyamuni Buddha, Padmasambhava, Guru Granth Sahib); the skip is only for articles that name none at all, such as Jandial at Taxila, whose dedication is genuinely unknown.
   - NEVER rewrite an `http://` official-site URL to `https://` to satisfy the schema. The schema takes https only, so an http-only official site means you OMIT `website` — a rewritten URL that does not load is worse than no URL. Thirteen records in wave 3 had to be repaired for exactly this.
3. Build the record:
{
 "id": "<kebab-case: name-place, short, ascii>",
 "name": "<canonical temple name>",
 "country": "...", "state": "...", "place": "...",
 "lat": <4dp>, "lng": <4dp>,
 "tradition": "Hindu|Buddhist|Jain|Sikh",
 "deity": "<presiding deity / dedication>",
 "built": [<fromYear int, negative=BCE>, <toYear int>],
 "builtDisplay": "<short human text, e.g. '12th c. (Chola)' or 'rebuilt 1854'>",
 "dynasty": "<dynasty/era, e.g. 'Chola', 'Malla', 'Modern'; use 'Undetermined' only if the article gives nothing>",
 "style": "<style if stated, else omit>",
 "circuits": <copy the target's circuits array>,
 "significance": "<1-2 sentences IN YOUR OWN WORDS from the article: what it is + why it matters>",
 "story": "<1 sentence of its legend IF the article tells one, else omit>",
 "website": "<official site if the article lists one, https only, else omit>",
 "wiki": "<resolved wikipedia URL>",
 "sources": [{"l":"Wikipedia","u":"<wiki url>"}] (+ {"l":"Official site","u":"<website>"} if website present),
 "verified": "wikipedia-2026-08-27",
 "tier": "compact"
}
 - built: century-level ints are fine (e.g. 12th c. → [1100,1200]). If the article dates only the ancient origin and the current structure separately, use the current structure and add "origin": <int year> for the origin. If no dating at all: built [1000,1800], builtDisplay "dating unrecorded".
 - Country policy: sites in Pakistan-occupied Jammu & Kashmir are recorded with country "India". Follow the target's country otherwise unless the article shows the target is mislocated.
4. Write ALL records as one JSON array to your OUTPUT file with the Write tool. Valid JSON, UTF-8. This file is the deliverable. Rewrite the whole array every ~12 targets so an interruption never loses more than a few records.

## What happens to your output

`node scripts/merge-batches.mjs data/batches/records_NN.json` merges it into
`data/sites.json`. It will DROP, with a logged reason, any record that is unsourced,
outside the map bounds, missing a required field, or malformed — it never repairs one
by guessing. It de-duplicates on coordinates at 3 dp **plus a related name**, and on
an identical name within 25 km. Then `npm run validate` gates the build,
`node scripts/audit-records.mjs --net` checks that every URL you cited actually
resolves, and `node scripts/prune-dead-websites.mjs` strips official-site links that
have gone dark. A fabricated citation does not survive that pipeline, so do not make one.

FINAL MESSAGE: only counts (built / skipped-duplicate / skipped-no-article / skipped-no-coords) and the list of skipped names with reason. Do not restate records.
