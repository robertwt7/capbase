import type { Sector } from '@repo/api';

/** Deterministic map from the SEC Form D `industryGroupType` taxonomy (a fixed,
 *  enumerable vocabulary) onto the canonical Sector list. `null` means the
 *  industry carries no useful sector signal ("Other", "Business Services") and
 *  the company stays unclassified. */
export const SEC_SECTOR_MAP: Readonly<Record<string, Sector | null>> = {
  Agriculture: 'Industrials',
  'Airlines and Airports': 'Transport',
  Biotechnology: 'Healthcare',
  'Business Services': null,
  'Coal Mining': 'Energy',
  Commercial: 'Real estate',
  'Commercial Banking': 'Financial services',
  Computers: 'Technology',
  Construction: 'Real estate',
  'Electric Utilities': 'Energy',
  'Energy Conservation': 'Climate',
  'Environmental Services': 'Climate',
  'Health Insurance': 'Healthcare',
  'Hospitals and Physicians': 'Healthcare',
  Insurance: 'Financial services',
  Investing: 'Financial services',
  'Investment Banking': 'Financial services',
  'Lodging and Conventions': 'Consumer & retail',
  Manufacturing: 'Industrials',
  'Oil and Gas': 'Energy',
  Other: null,
  'Other Banking and Financial Services': 'Financial services',
  'Other Energy': 'Energy',
  'Other Health Care': 'Healthcare',
  'Other Real Estate': 'Real estate',
  'Other Technology': 'Technology',
  'Other Travel': 'Consumer & retail',
  Pharmaceuticals: 'Healthcare',
  'Pooled Investment Fund': 'Financial services',
  'REITS and Finance': 'Real estate',
  Residential: 'Real estate',
  Restaurants: 'Consumer & retail',
  Retailing: 'Consumer & retail',
  Telecommunications: 'Media & telecom',
  'Tourism and Travel Services': 'Consumer & retail',
};

/** Sector for a Form D industry group; null when unknown or unmapped. */
export const secSector = (industry: string): Sector | null =>
  SEC_SECTOR_MAP[industry] ?? null;
