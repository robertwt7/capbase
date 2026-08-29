import type { Sector } from '@repo/api';

/**
 * Sector implied by the agency that funded the award.
 *
 * Structural, not guessed: an agency's mission *is* its sector. The entries
 * mapped to null fund every sector there is, so for those the award titles have
 * to decide — a Department of Defense award can be anything from a vaccine to a
 * jet engine, and stamping them all "Industrials" would be a lie at scale.
 */
export const AGENCY_SECTOR_MAP: Readonly<Record<string, Sector | null>> = {
  'Department of Health and Human Services': 'Healthcare',
  'Department of Energy': 'Energy',
  'Department of Agriculture': 'Industrials',
  'Department of Transportation': 'Transport',
  'Environmental Protection Agency': 'Climate',
  'Department of Education': 'Education',
  'National Aeronautics and Space Administration': 'Industrials',
  'Department of Commerce': null,
  'Department of Defense': null, // funds every sector; let the keywords decide
  'National Science Foundation': null,
  'Department of Homeland Security': null,
  'Nuclear Regulatory Commission': 'Energy',
  'Department of the Interior': null,
};

export function agencySector(agency: string | undefined): Sector | null {
  return AGENCY_SECTOR_MAP[(agency ?? '').trim()] ?? null;
}

/** Short label for a round name: 'National Aeronautics and Space
 *  Administration' is not something to print on a funding ladder. */
const AGENCY_SHORT: Readonly<Record<string, string>> = {
  'Department of Health and Human Services': 'HHS',
  'Department of Energy': 'DOE',
  'Department of Agriculture': 'USDA',
  'Department of Transportation': 'DOT',
  'Environmental Protection Agency': 'EPA',
  'Department of Education': 'ED',
  'National Aeronautics and Space Administration': 'NASA',
  'Department of Commerce': 'DOC',
  'Department of Defense': 'DOD',
  'National Science Foundation': 'NSF',
  'Department of Homeland Security': 'DHS',
  'Nuclear Regulatory Commission': 'NRC',
  'Department of the Interior': 'DOI',
};

export function agencyShort(agency: string | undefined): string {
  const value = (agency ?? '').trim();
  return AGENCY_SHORT[value] ?? value;
}
