import type { Sector } from './company';

/**
 * The vertical vocabulary: a second level under SECTORS. Each entry has exactly one parent
 * sector. Verticals are derived from the structured source labels in `Company.industry`
 * (`domain/vertical-map.ts`) or set by an approved edit — never guessed from a name.
 *
 * Artificial intelligence, Enterprise SaaS and Fintech have no verticals: no source label
 * states them.
 */
export const VERTICAL_SECTOR = {
  Software: 'Technology',
  'Video games': 'Technology',
  'Internet services': 'Technology',
  'IT services': 'Technology',
  'Cloud & hosting': 'Technology',
  Cybersecurity: 'Technology',
  'Computer hardware': 'Technology',
  Semiconductors: 'Technology',
  Electronics: 'Technology',
  'Information services': 'Technology',
  Banking: 'Financial services',
  'Lending & leasing': 'Financial services',
  Insurance: 'Financial services',
  Reinsurance: 'Financial services',
  'Insurance brokerage': 'Financial services',
  Pensions: 'Financial services',
  'Asset management': 'Financial services',
  'Capital markets': 'Financial services',
  Biotechnology: 'Healthcare',
  Pharmaceuticals: 'Healthcare',
  'Medical devices': 'Healthcare',
  'Healthcare IT': 'Healthcare',
  'Healthcare providers': 'Healthcare',
  'Residential care': 'Healthcare',
  'Health insurance': 'Healthcare',
  'Oil & gas': 'Energy',
  Coal: 'Energy',
  'Power & utilities': 'Energy',
  'Petroleum refining': 'Energy',
  'Renewable energy': 'Climate',
  'Energy storage & batteries': 'Climate',
  'Waste & environmental services': 'Climate',
  'Energy efficiency': 'Climate',
  'Commercial real estate': 'Real estate',
  'Residential real estate': 'Real estate',
  'Property development': 'Real estate',
  'Property letting': 'Real estate',
  'Real estate services': 'Real estate',
  'REITs & real estate finance': 'Real estate',
  Construction: 'Industrials',
  'Industrial machinery': 'Industrials',
  Aerospace: 'Industrials',
  Defence: 'Industrials',
  Chemicals: 'Industrials',
  Materials: 'Industrials',
  'Metal products': 'Industrials',
  Packaging: 'Industrials',
  'Electrical equipment': 'Industrials',
  HVAC: 'Industrials',
  Mining: 'Industrials',
  Agribusiness: 'Industrials',
  'Forestry & timber': 'Industrials',
  'Engineering services': 'Industrials',
  'Business process outsourcing': 'Industrials',
  'Staffing & recruitment': 'Industrials',
  'Logistics & freight': 'Transport',
  Shipping: 'Transport',
  Aviation: 'Transport',
  'Passenger transport': 'Transport',
  Rail: 'Transport',
  Automotive: 'Transport',
  Shipbuilding: 'Transport',
  'Consumer products': 'Consumer & retail',
  'Consumer services': 'Consumer & retail',
  'Food & beverage': 'Consumer & retail',
  Retail: 'Consumer & retail',
  'E-commerce': 'Consumer & retail',
  Grocery: 'Consumer & retail',
  'Fashion & apparel': 'Consumer & retail',
  'Wholesale & distribution': 'Consumer & retail',
  'Motor trade': 'Consumer & retail',
  'Restaurants & food service': 'Consumer & retail',
  'Hotels & accommodation': 'Consumer & retail',
  'Travel & leisure': 'Consumer & retail',
  'Sports & fitness': 'Consumer & retail',
  Gambling: 'Consumer & retail',
  Telecommunications: 'Media & telecom',
  'Media & entertainment': 'Media & telecom',
  Publishing: 'Media & telecom',
  'Marketing & advertising': 'Media & telecom',
  Schools: 'Education',
  'Higher education': 'Education',
  'Training & tutoring': 'Education',
  Edtech: 'Education',
} as const satisfies Record<string, Sector>;

export type Vertical = keyof typeof VERTICAL_SECTOR;
export const VERTICALS = Object.keys(VERTICAL_SECTOR) as readonly Vertical[];

/** At most this many on one company through an edit proposal. */
export const MAX_COMPANY_VERTICALS = 5;
/** A vertical page exists from this many companies; it is indexable from this many public ones. */
export const VERTICAL_PAGE_MIN_COMPANIES = 10;
/** Companies previewed per stage on a vertical page, largest first. */
export const VERTICAL_STAGE_PREVIEW = 10;

/** URL slug for a sector or vertical label ("Oil & gas" → "oil-gas"). */
export const labelSlug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const isVertical = (v: string): v is Vertical =>
  Object.prototype.hasOwnProperty.call(VERTICAL_SECTOR, v);

export const verticalsOf = (sector: Sector): Vertical[] =>
  VERTICALS.filter((v) => VERTICAL_SECTOR[v] === sector);

export const verticalFromSlug = (slug: string): Vertical | undefined =>
  VERTICALS.find((v) => labelSlug(v) === slug);

/** Where a vertical came from, for the profile. `contributor` = set by an approved edit. */
export interface VerticalSource {
  vertical: Vertical;
  scheme: 'sic' | 'formD' | 'wikidata' | 'partner' | 'contributor';
  label?: string;
  /** SIC 2007 code, for `sic`. */
  code?: string;
}
