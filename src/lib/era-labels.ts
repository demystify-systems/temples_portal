/**
 * Era labels that stay distinguishable after translation.
 *
 * WHAT WENT WRONG
 * ---------------
 * The six eras are qualified forms of three words: EARLY medieval, HIGH
 * medieval, LATE medieval; EARLY modern, modern. Asked for each in isolation,
 * Mayura returns the base word and drops the qualifier — so seven of the eight
 * offered languages came back with collisions, and Bengali, Tamil and Kannada
 * rendered THREE eras as one identical word.
 *
 * On screen that is three identical buttons on the era strip and three
 * identical swatches in the key: not a rough translation, a broken control.
 * It is strictly worse than leaving the label in English, because English at
 * least tells you which era you are pressing.
 *
 * WHAT THIS DOES
 * --------------
 * Any group of eras sharing a label falls back to English — the whole group,
 * not one of them, because keeping either would silently mislabel the other.
 * Labels that are already unambiguous are untouched, so a language loses only
 * the words it could not distinguish.
 *
 * This is a floor, not a fix. The real repair is better translations, pinned
 * through OVERRIDES in scripts/build-ui-translations.mjs by someone who reads
 * the language — at which point this quietly stops applying to them. A test
 * asserts the rendered set is always pairwise distinct.
 */
export const distinctEraLabels = (
  translated: readonly string[],
  english: readonly string[],
): readonly string[] => {
  const seen = new Map<string, number>();
  for (const label of translated) seen.set(label, (seen.get(label) ?? 0) + 1);

  return translated.map((label, i) => ((seen.get(label) ?? 0) > 1 ? (english[i] ?? label) : label));
};
