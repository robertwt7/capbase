/**
 * Innovate UK publishes no per-award page, so — like SBIR — a citation points at
 * the dataset that was actually read, carrying the project number as its
 * reference. The UKRI publication page is the stable address: the two xlsx
 * files behind it are re-uploaded under new names each refresh.
 */
export const INNOVATE_UK_DATASET_URL =
  'https://www.ukri.org/publications/innovate-uk-funded-projects-since-2004/';

export const INNOVATE_UK_PUBLISHER = 'UK Research and Innovation';
export const INNOVATE_UK_DATASET_TITLE = 'Innovate UK funded projects since 2004 (UKRI)';

/** The project number at the front of a round's externalId (`107572:05002194`),
 *  or null when the id has no separator. */
export function projectReference(externalId: string): string | null {
  const at = externalId.indexOf(':');
  if (at <= 0) return null;
  return externalId.slice(0, at).trim() || null;
}
