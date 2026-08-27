/**
 * Titles, descriptions, keywords and answer snippets — derived strictly from
 * what a record already says.
 *
 * Two constitution rules shape every function here:
 *
 * - **Rule 2 — no source → no field → no publish.** Nothing below invents a
 *   clause, a superlative or a connective to reach a target length. When the
 *   field a helper reads is missing, the helper returns `null`. A page with no
 *   meta description is honest; a page with a description we made up is not.
 * - **Rule 3 — history ≠ katha.** `significance` holds documented history;
 *   `story` holds legend (*sthala katha*). A meta description and an AI answer
 *   snippet are both read as factual summaries, so they may only ever be drawn
 *   from `significance`. `SeoSite` therefore does not declare `story` at all:
 *   these helpers cannot reach the legend even by accident, and a future edit
 *   that tried to would not type-check.
 *
 * Like site-utils.ts, everything here is a function of its arguments only, so it
 * is testable without loading data/sites.json — see seo.test.ts.
 */

/**
 * The only fields these helpers may read.
 *
 * Deliberately narrower than `Site`: a full record is structurally assignable to
 * it, but nothing here can see `story`, `phone`, `wiki` or the coordinates.
 * Everything is optional because "the field is missing" is a real, expected
 * state that must produce `null` rather than a guess.
 */
export type SeoSite = {
  readonly name?: string;
  readonly place?: string;
  readonly state?: string;
  readonly deity?: string;
  readonly builtDisplay?: string;
  readonly dynasty?: string;
  readonly style?: string;
  readonly circuits?: readonly string[];
  readonly significance?: string;
};

/** Google truncates a title around 60 characters; past that the tail is lost. */
export const TITLE_MAX_LENGTH = 60;

/** The window a meta description should land in — when the source is long enough. */
export const DESCRIPTION_MIN_LENGTH = 150;
export const DESCRIPTION_MAX_LENGTH = 160;

/** An answer-engine snippet: long enough to answer, short enough to be quoted whole. */
export const ANSWER_MAX_LENGTH = 320;

/** A keyword is a term, not a sentence; corpus `style` values run to 100+ chars. */
const KEYWORD_MAX_LENGTH = 40;

const ELLIPSIS = "…";

const collapse = (value?: string | null): string => (value ?? "").replace(/\s+/g, " ").trim();

/**
 * Does this value carry actual content?
 *
 * The corpus uses "—" as an explicit "not established" marker in `dynasty` and
 * `style`. An em dash is text but it is not a fact, so anything without a letter
 * or a digit is treated as absent.
 */
const hasText = (value?: string | null): boolean => /[\p{L}\p{N}]/u.test(collapse(value));

/** The collapsed value, or `null` when the field is missing or a placeholder. */
const text = (value?: string | null): string | null => (hasText(value) ? collapse(value) : null);

/**
 * Cut to `max` characters on a word boundary, marking the cut with an ellipsis.
 *
 * The ellipsis is counted, so the result never exceeds `max`. A value with no
 * space inside the budget is cut mid-word — there is no boundary to honour —
 * which is the only case where this does not end on a whole word.
 */
export const truncateAtWord = (value: string, max: number): string => {
  const source = collapse(value);
  if (source.length <= max) return source;

  const head = source.slice(0, Math.max(1, max - ELLIPSIS.length));
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  const trimmed = cut.replace(/[\s,;:.\-–—]+$/u, "");
  return `${trimmed.length > 0 ? trimmed : cut}${ELLIPSIS}`;
};

/**
 * Tokens that end in a period without ending a sentence.
 *
 * "c." is the corpus's own century abbreviation ("c. 3rd c. BCE") and appears
 * inside `significance`; the rest are ordinary English abbreviations.
 */
const NON_TERMINAL_ABBREVIATIONS = new Set([
  "c", "ca", "cf", "eg", "ie", "etc", "approx", "fl", "r", "no", "vs",
  "st", "mt", "mts", "dr", "mr", "mrs", "ms", "prof", "rev", "fr", "sr", "jr",
]);

/** Does the token immediately before a period actually end a sentence? */
const isSentenceEnd = (chunk: string): boolean => {
  const word = chunk.replace(/[^\p{L}]/gu, "");
  // A number or a symbol before the period ("…completed in 1010.") ends a sentence.
  if (!word) return true;
  if (NON_TERMINAL_ABBREVIATIONS.has(word.toLowerCase())) return false;
  // A lone capital is an initial — "Arthur C. Clarke", "B. R. Ambedkar" — with
  // one exception: in this corpus "I" is a regnal number that does end sentences
  // ("…greatly expanded by Rajendra Chola I. It is also revered as…").
  if (word.length === 1 && word !== "I" && word === word.toUpperCase()) return false;
  return true;
};

/**
 * Split prose into sentences.
 *
 * A period only closes a sentence when whitespace and a capital (or an opening
 * quote) follow it *and* the token before it is not an abbreviation or an
 * initial. Getting this wrong is not cosmetic: a description cut after
 * "Arthur C." would read as a fabricated fragment.
 */
export const sentences = (value: string): readonly string[] => {
  const source = collapse(value);
  if (!source) return [];

  const boundary = /(\S*)[.!?]["')\]”’]?\s+(?=[\p{Lu}"'“(])/gu;
  const out: string[] = [];
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(source)) !== null) {
    if (!isSentenceEnd(match[1])) continue;
    const end = match.index + match[0].length;
    out.push(source.slice(start, end).trim());
    start = end;
  }
  if (start < source.length) out.push(source.slice(start).trim());

  return out.filter((sentence) => sentence.length > 0);
};

/** The head of a multi-clause field: "12th–18th c. (great corridor…)" → "12th–18th c." */
const firstClause = (value: string): string => {
  const head = collapse(value.split(/[(;,]/u)[0]);
  return head.length > 0 ? head : collapse(value);
};

/**
 * Assemble a title from the parts that survived.
 *
 * `noun` is the generic "temple" tail. It is the first thing dropped when space
 * runs out, because it is the only word in the title that the record did not
 * supply — a dated dynasty is worth more to a reader than a category label.
 */
const composeTitle = (
  name: string,
  place: string | null,
  built: string | null,
  dynasty: string | null,
  noun: string | null,
): string => {
  const head = place ? `${name}, ${place}` : name;
  const descriptors = [built, dynasty, noun].filter((part): part is string => Boolean(part));
  if (descriptors.length === 0) return head;
  return `${head} — ${descriptors.join(" ")}`;
};

/**
 * "<Name>, <Place> — <builtDisplay> <Dynasty> temple", inside 60 characters.
 *
 * Only 50 of the 1,122 records fit that full form: `builtDisplay` and `dynasty`
 * are frequently multi-clause ("built up 10th–17th c.; Rajagopuram 1987"). So
 * the title degrades through progressively shorter forms — each still built only
 * from real field values — and the first one that fits wins. Nothing is ever
 * abbreviated into a claim the record does not make; clauses are only dropped.
 *
 * Returns `null` when the record has no name.
 */
export const siteTitle = (site: SeoSite): string | null => {
  const name = text(site.name);
  if (!name) return null;

  const place = text(site.place);
  const built = text(site.builtDisplay);
  const dynasty = text(site.dynasty);
  const shortPlace = place ? firstClause(place) : null;
  const shortBuilt = built ? firstClause(built) : null;
  const shortDynasty = dynasty ? firstClause(dynasty) : null;

  // Ordered most informative first; the first one inside the bound wins. Each
  // rung only drops or shortens — no rung asserts anything a rung above did not.
  const candidates = [
    composeTitle(name, place, built, dynasty, "temple"),
    composeTitle(name, place, shortBuilt, shortDynasty, "temple"),
    composeTitle(name, shortPlace, shortBuilt, shortDynasty, "temple"),
    composeTitle(name, shortPlace, shortBuilt, null, "temple"),
    composeTitle(name, shortPlace, shortBuilt, null, null),
    composeTitle(name, shortPlace, null, null, null),
    name,
  ];

  return (
    candidates.find((candidate) => candidate.length <= TITLE_MAX_LENGTH) ??
    truncateAtWord(name, TITLE_MAX_LENGTH)
  );
};

/**
 * A 150–160 character meta description, drawn only from `significance`.
 *
 * Never from `story`: a legend presented as a page summary is exactly the blend
 * rule 3 forbids, and `SeoSite` does not expose the field. Never padded either —
 * a record whose `significance` is 76 characters long gets a 76-character
 * description, because the alternative is writing a sentence no source backs.
 *
 * Whole sentences are preferred; the ellipsis cut is the fallback.
 */
export const siteDescription = (site: SeoSite): string | null => {
  const source = text(site.significance);
  if (!source) return null;
  if (source.length <= DESCRIPTION_MAX_LENGTH) return source;

  let whole = "";
  for (const sentence of sentences(source)) {
    const next = whole ? `${whole} ${sentence}` : sentence;
    if (next.length > DESCRIPTION_MAX_LENGTH) break;
    whole = next;
  }
  if (whole.length >= DESCRIPTION_MIN_LENGTH) return whole;

  return truncateAtWord(source, DESCRIPTION_MAX_LENGTH);
};

/**
 * "Shiva (Brihadisvara)" → ["Shiva", "Brihadisvara"].
 *
 * Both halves are terms the record itself uses — the deity and the local form —
 * and a reader searching for either should land here. Nothing is added.
 */
const deityForms = (deity: string | null): readonly string[] => {
  if (!deity) return [];
  const head = collapse(deity.replace(/\([^)]*\)/g, " "));
  const aspects = [...deity.matchAll(/\(([^)]*)\)/g)].map((match) => collapse(match[1]));
  return [head, ...aspects];
};

/**
 * Keywords, strictly from `deity`, `dynasty`, `style`, `state` and `circuits`.
 *
 * Placeholders ("—") and prose-length values are dropped: some `style` entries
 * are full descriptive sentences, which are facts about the building but not
 * keywords. Returns an empty array when the record carries none of these fields
 * — an empty list, never an invented term.
 */
export const siteKeywords = (site: SeoSite): readonly string[] => {
  const candidates: readonly (string | null)[] = [
    ...deityForms(text(site.deity)),
    text(site.dynasty),
    text(site.style),
    text(site.state),
    ...(site.circuits ?? []),
  ];

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const candidate of candidates) {
    const value = text(candidate);
    if (!value || value.length > KEYWORD_MAX_LENGTH) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(value);
  }
  return keywords;
};

/**
 * The extractive answer to "what is <name>" — the AEO surface.
 *
 * One or two sentences lifted verbatim from `significance`, framed by the name
 * and, when the record dates it, `builtDisplay`. The frame exists because
 * `significance` sentences are often subject-less fragments ("The masterpiece of
 * Chola imperial architecture, completed in 1010 CE…") which do not answer the
 * question on their own. Every word of the body is the corpus's own; the frame
 * adds no claim beyond the two fields it names.
 *
 * Returns `null` when the record has no `significance` — there is no sourced
 * answer to give, and legend is not a substitute for one.
 */
export const answerSnippet = (site: SeoSite): string | null => {
  const source = text(site.significance);
  if (!source) return null;

  const parts = sentences(source);
  const one = parts[0] ?? source;
  const two = parts.slice(0, 2).join(" ");
  const body = truncateAtWord(two.length <= ANSWER_MAX_LENGTH && two ? two : one, ANSWER_MAX_LENGTH);

  const name = text(site.name);
  if (!name) return body;
  const dated = text(site.builtDisplay);
  return `${name}${dated ? ` (${dated})` : ""} — ${body}`;
};
