/** URL slug: lower case, words joined by hyphens. */
export function slugify(text) {
  return text.trim().toLowerCase().replace(/\s/g, '-');
}
