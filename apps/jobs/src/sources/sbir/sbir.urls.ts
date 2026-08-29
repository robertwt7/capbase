import { SBIR_AWARDS_CSV } from './sbir.client';

/**
 * SBIR awards have no per-award public page derivable from the bulk file, so a
 * citation points at the dataset that was actually read, carrying the award's
 * contract number as its reference.
 *
 * That is honest: the file IS the document the fact came from. A guessed award
 * URL would be worse than none — the standing rule for this backfill is that
 * every URL is constructed from identifiers on the row, never invented.
 */
export const SBIR_AWARD_DATA_URL = SBIR_AWARDS_CSV;

export const SBIR_PUBLISHER = 'SBIR.gov';
export const SBIR_DATASET_TITLE = 'SBIR/STTR award data (SBIR.gov bulk file)';

/** The contract number carried in the suffix of an SBIR round's externalId
 *  (`uei:XYZ:FA2541-26-C-B007`), or null when the id has no suffix. */
export function awardReference(externalId: string): string | null {
  const at = externalId.lastIndexOf(':');
  if (at < 0) return null;
  const reference = externalId.slice(at + 1).trim();
  return reference || null;
}
