/**
 * What the reader is looking at, derived from the route.
 *
 * WHY THE ASSISTANT NEEDS IT
 * --------------------------
 * "Who built this?" on a temple page has an obvious antecedent to the person
 * asking and none at all to the model, which receives the sentence and nothing
 * else. Without the page, that question either gets refused or — worse — gets
 * answered about whichever temple the retriever happened to like.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a shortcut around rule 2. The context supplies a SUBJECT, never a fact:
 * the id is resolved against the corpus server-side and the record's own cited
 * fields are what the model may use. A page id that matches nothing simply adds
 * nothing.
 *
 * The id crosses the network and reaches a corpus lookup, so it is validated
 * here as a slug rather than trusted for having come from our own router.
 */

/** Pages the assistant can be opened on that name a single subject. */
export type ContextKind = "site" | "dynasty" | "circuit" | "deity" | "patron";

export type PageContext =
  | { readonly kind: ContextKind; readonly id: string }
  | { readonly kind: "map" }
  | { readonly kind: "gazetteer" };

/** The record routes, each `/<segment>/<slug>`. */
const SUBJECT_ROUTES: Readonly<Record<string, ContextKind>> = {
  site: "site",
  dynasty: "dynasty",
  circuit: "circuit",
  deity: "deity",
  patron: "patron",
};

/** Slugs this project generates: lowercase, digits, single hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 120;

export const pageContext = (pathname: string): PageContext | null => {
  if (!pathname) return null;
  const path = pathname.split("?")[0]!.split("#")[0]!.replace(/\/+$/, "");

  if (path === "") return { kind: "map" };
  if (path === "/sites") return { kind: "gazetteer" };

  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) return null;

  const kind = SUBJECT_ROUTES[parts[0]!];
  const id = parts[1]!;
  if (!kind || id.length > MAX_SLUG || !SLUG.test(id)) return null;

  return { kind, id };
};

/**
 * How the prompt refers to the page.
 *
 * Deliberately vague about WHICH one: the record itself is handed over
 * separately, already cited. Naming it twice invites the model to treat the
 * label as a fact it may repeat.
 */
export const contextLabel = (ctx: PageContext | null): string | null => {
  if (!ctx) return null;
  switch (ctx.kind) {
    case "site": return "the page for one specific site";
    case "dynasty": return "a dynasty's page";
    case "circuit": return "a pilgrimage circuit's page";
    case "deity": return "a deity's page";
    case "patron": return "a patron's page";
    case "map": return "the atlas map";
    case "gazetteer": return "the gazetteer index";
  }
};
