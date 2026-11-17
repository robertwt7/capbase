import { normaliseSicText, SIC2007 } from './sic2007';
import type { Vertical, VerticalSource } from './verticals';

/**
 * The reviewed source-label → vertical mapping (plan
 * `thoughts/shared/plans/2026-11-16-vertical-taxonomy-and-market-maps.md`, Phase 1). Pure, so
 * jobs (derive at ingest and in the backfill) and the API (explain on the profile) run identical
 * code. Not in `entry.ts`: imported as `@repo/api/domain/vertical-map`.
 *
 * A label maps only when its publisher's closed vocabulary states the vertical. An explicit
 * `null` is a reviewed "this label does not say" (it restates a sector, is ambiguous, or names
 * an asset rather than an industry); an unlisted label stays unmapped until reviewed. No keyword
 * or name heuristics. After any change here, re-run `make backfill-verticals[-prod]` and
 * `make audit-verticals[-prod]`, and update the plan's tables in the same change.
 */

/** Partner primary industry → vertical; null = restates the sector, or ambiguous. */
export const PARTNER_VERTICALS: Readonly<Record<string, Vertical | null>> = {
  Software: 'Software',
  Internet: 'Internet services',
  Hardware: 'Computer hardware',
  'IT Infrastructure': 'Cloud & hosting',
  Semiconductors: 'Semiconductors',
  Electronics: 'Electronics',
  'Information Services': 'Information services',
  'IT Security/Cybersecurity': 'Cybersecurity',
  'Financial Services': null,
  Insurance: 'Insurance',
  Biotechnology: 'Biotechnology',
  Pharmaceuticals: 'Pharmaceuticals',
  'Medical Devices & Equipment': 'Medical devices',
  Healthcare: null,
  'Healthcare IT': 'Healthcare IT',
  'Healthcare Specialists': null,
  'Consumer Products': 'Consumer products',
  'Consumer Services': 'Consumer services',
  Retail: 'Retail',
  Food: 'Food & beverage',
  Bottling: 'Food & beverage',
  'Travel & Leisure': 'Travel & leisure',
  Media: 'Media & entertainment',
  'Marketing/Advertising': 'Marketing & advertising',
  Telecoms: 'Telecommunications',
  'Education/Training': null,
  'Logistics & Distribution': 'Logistics & freight',
  'Transportation Services': null,
  'Automobiles, Other Vehicles & Parts': 'Automotive',
  'Rail Transport': 'Rail',
  'Ship Building & Repair': 'Shipbuilding',
  'Oil & Gas': 'Oil & gas',
  'Power & Utilities': 'Power & utilities',
  'Renewable Energy': 'Renewable energy',
  'Energy Storage & Batteries': 'Energy storage & batteries',
  'Environmental Services': 'Waste & environmental services',
  'Real Estate Development & Operating Companies': 'Property development',
  'Commercial Property': 'Commercial real estate',
  'Industrial Machinery': 'Industrial machinery',
  Materials: 'Materials',
  Chemicals: 'Chemicals',
  Packaging: 'Packaging',
  Aerospace: 'Aerospace',
  Defence: 'Defence',
  'Heating, Cooling & Ventilation Equipment and Services': 'HVAC',
  Mining: 'Mining',
  'Forestry & Timber': 'Forestry & timber',
  Biopolymers: 'Materials',
  Construction: 'Construction',
  Agribusiness: 'Agribusiness',
  'Business Support Services': null,
  Outsourcing: 'Business process outsourcing',
};

/** Form D industryGroupType → vertical; null = "Other …" or restates the sector. */
export const FORM_D_VERTICALS: Readonly<Record<string, Vertical | null>> = {
  Agriculture: 'Agribusiness',
  'Airlines and Airports': 'Aviation',
  Biotechnology: 'Biotechnology',
  'Business Services': null,
  'Coal Mining': 'Coal',
  Commercial: 'Commercial real estate',
  'Commercial Banking': 'Banking',
  Computers: 'Computer hardware',
  Construction: 'Construction',
  'Electric Utilities': 'Power & utilities',
  'Energy Conservation': 'Energy efficiency',
  'Environmental Services': 'Waste & environmental services',
  'Health Insurance': 'Health insurance',
  'Hospitals and Physicians': 'Healthcare providers',
  Insurance: 'Insurance',
  Investing: null,
  'Investment Banking': 'Capital markets',
  'Lodging and Conventions': 'Hotels & accommodation',
  Manufacturing: null,
  'Oil and Gas': 'Oil & gas',
  Other: null,
  'Other Banking and Financial Services': null,
  'Other Energy': null,
  'Other Health Care': null,
  'Other Real Estate': null,
  'Other Technology': null,
  'Other Travel': null,
  Pharmaceuticals: 'Pharmaceuticals',
  'Pooled Investment Fund': null,
  'REITS and Finance': 'REITs & real estate finance',
  Residential: 'Residential real estate',
  Restaurants: 'Restaurants & food service',
  Retailing: 'Retail',
  Telecommunications: 'Telecommunications',
  'Tourism and Travel Services': 'Travel & leisure',
};

/** Wikidata P452 label → vertical. Labels with ≥ 2 uses on 2026-11-16 were reviewed;
 *  singletons stay unmapped until they recur. Case-sensitive. */
export const WIKIDATA_VERTICALS: Readonly<Record<string, Vertical | null>> = {
  'telecommunications industry': 'Telecommunications',
  'agriculture, forestry and fishing': 'Agribusiness',
  Software: 'Software',
  'software industry': 'Software',
  'software as a service': 'Software',
  'software development': 'Software',
  'waste management': 'Waste & environmental services',
  Internet: 'Internet services',
  'Internet industry': 'Internet services',
  'e-commerce': 'E-commerce',
  'online marketplace': 'E-commerce',
  'food delivery': 'E-commerce',
  'online food ordering': 'E-commerce',
  'video game industry': 'Video games',
  'space industry': 'Aerospace',
  'aerospace industry': 'Aerospace',
  'aircraft industry': 'Aerospace',
  'educational technology': 'Edtech',
  construction: 'Construction',
  'computer security': 'Cybersecurity',
  'cloud computing': 'Cloud & hosting',
  'platform as a service': 'Cloud & hosting',
  'cloud storage': 'Cloud & hosting',
  'food industry': 'Food & beverage',
  retail: 'Retail',
  'information technology': 'IT services',
  'information technology industry': 'IT services',
  'biotechnology industry': 'Biotechnology',
  'electronics industry': 'Electronics',
  'pharmaceutical industry': 'Pharmaceuticals',
  'real estate development': 'Property development',
  publishing: 'Publishing',
  'news media': 'Publishing',
  logistics: 'Logistics & freight',
  tourism: 'Travel & leisure',
  'autonomous car': 'Automotive',
  podcast: 'Media & entertainment',
  // Assets or products, not industries (mostly EIB loan "projects").
  'line of credit': null,
  'sewer network': null,
  'urban planning': null,
  'infrastructure industry': null,
  // Restate a sector.
  transport: null,
  'energy sector': null,
  'energy industry': null,
  industry: null,
  service: null,
  education: null,
  'health sector': null,
  'health care': null,
  'health care industry': null,
  technology: null,
  'financial services': null,
  'industrial manufacturing': null,
  // Sectors that ship without verticals, or no vertical states them.
  'artificial intelligence': null,
  fintech: null,
  'mobile payment industry': null,
  'cryptocurrency industry': null,
  'quantum computing industry': null,
  // No fitting vertical.
  surveillance: null,
  kickboxing: null,
  'bicycle industry': null,
};

type SicRule = readonly [low: number, high: number, vertical: Vertical];

/** SIC 2007 [low, high] → vertical, FIRST MATCH WINS (carve-outs above their bands), the
 *  `sic-sector.ts` style. Unlisted codes have no vertical: holding companies and fund vehicles
 *  (64201–64209, 64301–64306), head offices (70100), dormant/non-trading (99999, 74990),
 *  64999, 66190, the catch-alls 32990, 74909, 82990, 96090, the professions (69, 70, 74) and
 *  public/social services (84, 88, 94). */
export const SIC_VERTICAL_RULES: readonly SicRule[] = [
  // Carve-outs, then specific bands (the plan's left column).
  [25400, 25400, 'Defence'],
  [30400, 30400, 'Defence'],
  [30300, 30300, 'Aerospace'],
  [30110, 30120, 'Shipbuilding'],
  [30200, 30200, 'Rail'],
  [29100, 29320, 'Automotive'],
  [30910, 30920, 'Automotive'],
  [27200, 27200, 'Energy storage & batteries'],
  [28250, 28250, 'HVAC'],
  [21100, 21200, 'Pharmaceuticals'],
  [32500, 32500, 'Medical devices'],
  [72110, 72110, 'Biotechnology'],
  [26200, 26200, 'Computer hardware'],
  [26110, 26800, 'Electronics'],
  [58210, 58210, 'Video games'],
  [62011, 62011, 'Video games'],
  [58290, 58290, 'Software'],
  [62012, 62012, 'Software'],
  [62020, 62090, 'IT services'],
  [63110, 63110, 'Cloud & hosting'],
  [63120, 63120, 'Internet services'],
  [63910, 63910, 'Publishing'],
  [58110, 58190, 'Publishing'],
  [63990, 63990, 'Information services'],
  [59110, 60200, 'Media & entertainment'],
  [61100, 61900, 'Telecommunications'],
  [73110, 73200, 'Marketing & advertising'],
  [70210, 70210, 'Marketing & advertising'],
  [2100, 2400, 'Forestry & timber'],
  [16100, 16290, 'Forestry & timber'],
  [17211, 17211, 'Packaging'],
  [22220, 22220, 'Packaging'],
  [82920, 82920, 'Packaging'],
  [22110, 24540, 'Materials'],
  [27110, 27900, 'Electrical equipment'],
  [71111, 71200, 'Engineering services'],
  [78100, 78300, 'Staffing & recruitment'],
  [49100, 49200, 'Rail'],
  [49311, 49390, 'Passenger transport'],
  [45111, 45400, 'Motor trade'],
  [47910, 47910, 'E-commerce'],
  [47710, 47722, 'Fashion & apparel'],
  [55100, 55900, 'Hotels & accommodation'],
  [79110, 79909, 'Travel & leisure'],
  [93110, 93290, 'Sports & fitness'],
  [85410, 85422, 'Higher education'],
  // Broad bands (the plan's right column).
  [64110, 64192, 'Banking'],
  [64910, 64929, 'Lending & leasing'],
  [64992, 64992, 'Lending & leasing'],
  [64991, 64991, 'Capital markets'],
  [66110, 66120, 'Capital markets'],
  [65110, 65120, 'Insurance'],
  [65201, 65202, 'Reinsurance'],
  [65300, 65300, 'Pensions'],
  [66210, 66290, 'Insurance brokerage'],
  [66300, 66300, 'Asset management'],
  [86101, 86900, 'Healthcare providers'],
  [87100, 87900, 'Residential care'],
  [5101, 5200, 'Coal'],
  [6100, 6200, 'Oil & gas'],
  [9100, 9100, 'Oil & gas'],
  [19100, 19209, 'Petroleum refining'],
  [7100, 8990, 'Mining'],
  [35110, 36000, 'Power & utilities'],
  [37000, 39000, 'Waste & environmental services'],
  [41100, 41100, 'Property development'],
  [68100, 68209, 'Property letting'],
  [68310, 68320, 'Real estate services'],
  [41201, 43999, 'Construction'],
  [10110, 11070, 'Food & beverage'],
  [13100, 15200, 'Fashion & apparel'],
  [1110, 3220, 'Agribusiness'],
  [20110, 20600, 'Chemicals'],
  [25110, 25990, 'Metal products'],
  [28110, 28990, 'Industrial machinery'],
  [82110, 82110, 'Business process outsourcing'],
  [82200, 82200, 'Business process outsourcing'],
  [51101, 51220, 'Aviation'],
  [52230, 52230, 'Aviation'],
  [50100, 50400, 'Shipping'],
  [49410, 49420, 'Logistics & freight'],
  [52101, 52290, 'Logistics & freight'],
  [53100, 53202, 'Logistics & freight'],
  [46110, 46900, 'Wholesale & distribution'],
  [47110, 47290, 'Grocery'],
  [47300, 47990, 'Retail'],
  [56101, 56302, 'Restaurants & food service'],
  [92000, 92000, 'Gambling'],
  [85100, 85310, 'Schools'],
  [85510, 85600, 'Training & tutoring'],
];

/** The vertical for a five-digit SIC 2007 code, or null. */
export function verticalForSicCode(code: string | number): Vertical | null {
  const n = typeof code === 'number' ? code : Number(code);
  if (!Number.isFinite(n)) return null;
  for (const [low, high, vertical] of SIC_VERTICAL_RULES) {
    if (n >= low && n <= high) return vertical;
  }
  return null;
}

const has = (table: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

/** One label's vertical and where it came from; null when no table states one. */
function labelSource(label: string, partnerMarked: boolean): VerticalSource | null {
  if (partnerMarked && has(PARTNER_VERTICALS, label)) {
    const v = PARTNER_VERTICALS[label];
    return v ? { vertical: v, scheme: 'partner', label } : null;
  }
  if (has(FORM_D_VERTICALS, label)) {
    const v = FORM_D_VERTICALS[label];
    return v ? { vertical: v, scheme: 'formD', label } : null;
  }
  if (has(WIKIDATA_VERTICALS, label)) {
    const v = WIKIDATA_VERTICALS[label];
    return v ? { vertical: v, scheme: 'wikidata', label } : null;
  }
  const code = SIC2007[normaliseSicText(label)];
  if (code) {
    const v = verticalForSicCode(code);
    return v ? { vertical: v, scheme: 'sic', label, code } : null;
  }
  return null;
}

/** One company's verticals from its stored labels. Partner-marked labels read the partner
 *  table first; every other label is looked up in Form D, then Wikidata, then (as SIC text)
 *  the SIC rules. Order follows the labels, duplicates dropped. The lookup ignores the row's
 *  source: the vocabularies' texts don't collide (enforced by `vertical-map.spec.ts`). */
export function deriveVerticals(
  labels: readonly string[],
  partnerMarked: boolean,
): { verticals: Vertical[]; sources: VerticalSource[] } {
  const verticals: Vertical[] = [];
  const sources: VerticalSource[] = [];
  for (const label of labels) {
    const source = labelSource(label, partnerMarked);
    if (!source || verticals.includes(source.vertical)) continue;
    verticals.push(source.vertical);
    sources.push(source);
  }
  return { verticals, sources };
}

/** Sources for already-stored verticals: the derivation's, or `contributor` for a vertical no
 *  label produces (an approved edit). Follows the stored order. */
export function explainVerticals(
  stored: readonly Vertical[],
  labels: readonly string[],
  partnerMarked: boolean,
): VerticalSource[] {
  const { sources } = deriveVerticals(labels, partnerMarked);
  return stored.map(
    (vertical) =>
      sources.find((s) => s.vertical === vertical) ?? { vertical, scheme: 'contributor' },
  );
}
