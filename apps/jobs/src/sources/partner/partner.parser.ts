/**
 * Pure mapping from the partner snapshot (the `partner_stage` schema,
 * see partner.client.ts) to the normalized ingest shapes.
 *
 * Every controlled value here is read from one of the partner's CLOSED
 * vocabularies — its firm type, fund status, asset class, primary industry and
 * deal stage fields — through an explicit table. Nothing is inferred from a
 * name or from free text: a value that is not in a table maps to null (or the
 * row is dropped, where the table says so).
 */
import {
  countryCodeFromName,
  type FundStatus,
  type FundStrategy,
  type InvestorType,
  type RoundKind,
  type Sector,
  type Stage,
} from '@repo/api';

import { hostOf, identifyingDomain, isLinkedInHost } from '../../util/domain';
import { stageFromAmount } from '../../util/stage';
import type { FxTable } from '../../util/fx';
import type {
  NormalizedFund,
  NormalizedFundCommitment,
  NormalizedFundMandate,
  NormalizedFundMetric,
  NormalizedInvestor,
  NormalizedInvestorFirm,
  NormalizedInvestorFocus,
  NormalizedPerson,
  NormalizedRecord,
  NormalizedRound,
  SourceFirmRef,
  SourceIdentifier,
} from '../ingestion-source';

/** Provenance tag, identifier scheme and public label stem: always "partner". */
export const PARTNER = 'PARTNER';

// --- Stage rows (column names as staged) -------------------------------------

export interface FirmRow {
  firm_id: string;
  name: string;
  role: 'manager' | 'lp' | 'both';
  manager_firm_type: string | null;
  lp_firm_type: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  year_established: number | null;
  about: string | null;
  aum_usd: number | null;
  vc_fund_share: number | null;
  deal_count: number;
}

export interface PersonRow {
  contact_id: string;
  firm_id: string;
  name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
}

export interface FundRow {
  fund_id: string;
  manager_id: string;
  name: string;
  status: string | null;
  asset_class: string | null;
  vintage: number | null;
  currency: string | null;
  size_usd: number | null;
  target_usd: number | null;
  hard_cap_usd: number | null;
  /** `YYYY-MM-DD`. */
  launch_date: string | null;
  latest_close_date: string | null;
  final_close_date: string | null;
  mgmt_fee_pct: number | null;
  carry_pct: number | null;
  hurdle_pct: number | null;
  irr_net_min: number | null;
  irr_net_max: number | null;
  irr_gross_min: number | null;
  irr_gross_max: number | null;
  region_focus: string | null;
  city: string | null;
  country: string | null;
}

export interface CompanyRow {
  company_id: string;
  name: string;
  country: string | null;
  city: string | null;
  website: string | null;
  industry: string | null;
  verticals: string | null;
  about: string | null;
  status: string | null;
}

export interface DealRow {
  deal_id: string;
  company_id: string;
  /** `YYYY-MM-DD`. */
  deal_date: string | null;
  stage: string | null;
  status: string | null;
  currency: string | null;
  size_local: number | null;
  size_usd: number | null;
}

/** A commitment joined to its fund (name, manager, currency, vintage). */
export interface CommitmentRow {
  fund_id: string;
  firm_id: string;
  amount_local: number | null;
  fund_name: string;
  manager_id: string;
  fund_currency: string | null;
  vintage: number | null;
}

/** A metric joined to its fund. */
export interface MetricRow {
  fund_id: string;
  /** `YYYY-MM-DD`. */
  as_at: string;
  dry_powder_local: number | null;
  aum_usd: number | null;
  unrealized_local: number | null;
  fund_name: string;
  manager_id: string;
  fund_currency: string | null;
}

/**
 * One firm's reported investment focus in one role (stage v2,
 * `partner_stage.firm_focus`). Labels are split with each field's own
 * delimiter but otherwise raw; amounts are in MILLIONS as published (0,
 * negative and absurd values included — the parser decides).
 */
export interface FirmFocusRow {
  firm_id: string;
  role: 'manager' | 'lp';
  /** `YYYY-MM-DD`. */
  reported_on: string | null;
  stages: string[] | null;
  main_strategy: string | null;
  strategies: string[] | null;
  industries: string[] | null;
  verticals: string[] | null;
  geographies: string[] | null;
  range_min_usd_mn: number | null;
  range_max_usd_mn: number | null;
  range_min_local_mn: number | null;
  range_max_local_mn: number | null;
  range_currency: string | null;
}

/** The stage v2 contract for `partner_stage.firm_focus` — what the preflight
 *  checks before any write. */
export const FIRM_FOCUS_COLUMNS = [
  'firm_id',
  'role',
  'reported_on',
  'stages',
  'main_strategy',
  'strategies',
  'industries',
  'verticals',
  'geographies',
  'range_min_usd_mn',
  'range_max_usd_mn',
  'range_min_local_mn',
  'range_max_local_mn',
  'range_currency',
] as const satisfies readonly (keyof FirmFocusRow)[];

/**
 * One fund's reported mandate and structure (stage v3,
 * `partner_stage.fund_mandate`). Industries and verticals are split on `;`
 * (their labels contain commas), geographies on `,`; otherwise raw.
 */
export interface FundMandateRow {
  fund_id: string;
  detailed_strategy: string | null;
  industries: string[] | null;
  verticals: string[] | null;
  geographic_focus: string[] | null;
  geographic_exposure: string[] | null;
  domicile: string | null;
  structure: string | null;
  legal_structure: string | null;
}

/** The stage v3 contract for `partner_stage.fund_mandate` — what the preflight
 *  checks before any write. */
export const FUND_MANDATE_COLUMNS = [
  'fund_id',
  'detailed_strategy',
  'industries',
  'verticals',
  'geographic_focus',
  'geographic_exposure',
  'domicile',
  'structure',
  'legal_structure',
] as const satisfies readonly (keyof FundMandateRow)[];

/** A firm that survived the type mapping, as edges need it. */
export interface KeptFirm {
  name: string;
  type: InvestorType;
}

// --- Identifiers ---------------------------------------------------------------

const pid = (value: string): SourceIdentifier => ({ scheme: 'PARTNER', value });

/** A firm as an edge endpoint (see SourceFirmRef). */
export const firmRef = (firmId: string): SourceFirmRef => ({ externalId: firmId, identifier: pid(firmId) });

// --- Firm type ----------------------------------------------------------------

/** Firm types that are a fund manager whose own fund mix decides VC vs PE. */
const MANAGER_TYPES = new Set([
  'Private Equity Firm',
  'Private Equity Firm (Investor)',
  'Fund Manager',
  'Investment Company',
  'Venture Capital',
]);

/** Every other firm type that IS an investor, mapped one to one. */
const FIRM_TYPES: Record<string, InvestorType> = {
  'Private Equity Fund of Funds Manager': 'Fund of funds',
  'Fund of Funds Manager': 'Fund of funds',
  'Secondary Fund of Funds Manager': 'Fund of funds',
  'Listed Fund of Funds Manager': 'Fund of funds',
  'Hybrid Fund of Funds Manager': 'Fund of funds',
  'Private Debt Fund of Funds Manager': 'Fund of funds',
  'Infrastructure Fund of Funds Manager': 'Fund of funds',
  'Real Estate Fund of Funds Manager': 'Fund of funds',
  'Real Assets Fund of Funds Manager': 'Fund of funds',
  'Fund of Hedge Funds Manager': 'Fund of funds',
  'Hedge Fund Manager': 'Hedge fund',
  'Corporate Investor': 'Corporate',
  'Family Office - Single': 'Family office',
  'Family Office - Multi': 'Family office',
  'Public Pension Fund': 'Pension fund',
  'Private Sector Pension Fund': 'Pension fund',
  'Superannuation Scheme': 'Pension fund',
  'Endowment Plan': 'Endowment',
  Foundation: 'Foundation',
  'Insurance Company': 'Insurance',
  Bank: 'Bank',
  'Investment Bank': 'Bank',
  'Wealth Manager': 'Wealth manager',
  'Asset Manager': 'Asset manager',
  'Asset Manager - Investor': 'Asset manager',
  'Asset Manager - Fund Manager': 'Asset manager',
  'Investment Trust': 'Asset manager',
  'Government Agency': 'Government',
  'Sovereign Wealth Fund': 'Sovereign wealth',
  'Private Debt Firm': 'Private equity',
  'Real Estate Firm': 'Private equity',
  'Real Estate Firm (Investor)': 'Private equity',
  'Infrastructure Firm': 'Private equity',
  'Natural Resources Firm': 'Private equity',
};

/** A manager is venture when at least half its funds are venture funds. */
export const VENTURE_SHARE = 0.5;

function mapType(firmType: string | null, firm: FirmRow): InvestorType | null {
  if (!firmType) return null;
  if (MANAGER_TYPES.has(firmType)) {
    // The partner files venture managers under "Private Equity Firm"; the
    // fund asset class is the structural signal. A manager with no funds in
    // the snapshot but with deals has only venture deals (the deal extract is
    // venture-only), so it is venture too.
    const share = firm.vc_fund_share;
    const venture = share != null ? share >= VENTURE_SHARE : firm.deal_count > 0;
    return venture ? 'Venture' : 'Private equity';
  }
  return FIRM_TYPES[firmType] ?? null;
}

/**
 * The firm's InvestorType, or null when the firm is not an investor at all
 * (an adviser, law firm, placement agent, consultant, …) — such a firm is
 * dropped, and so is every edge pointing at it. The manager type is read first
 * for a firm listed as both: it is what the firm is in the deal and fund data.
 */
export function firmType(firm: FirmRow): InvestorType | null {
  const asManager = firm.role !== 'lp' ? mapType(firm.manager_firm_type, firm) : null;
  return asManager ?? (firm.role !== 'manager' ? mapType(firm.lp_firm_type, firm) : null);
}

// --- Text, places, links --------------------------------------------------------

/** HTML tags and entities stripped, whitespace tidied. The partner's prose
 *  occasionally carries its own markup. */
export function cleanProse(text: string | null | undefined): string | null {
  if (!text) return null;
  const out = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out || null;
}

const ONE_LINER_MAX = 160;

/** Words whose trailing period does not end a sentence. */
const ABBREVIATIONS = new Set([
  'inc', 'ltd', 'co', 'corp', 'llc', 'plc', 'mr', 'mrs', 'ms', 'dr', 'st', 'no', 'vs', 'approx',
  'jr', 'sr', 'bros', 'est', 'dept', 'univ', 'intl', 'mfg', 'ave', 'blvd', 'fig', 'etc',
  'pvt', 'pte', 'pty', 'bhd', 'sdn', 'cia', 'ag', 'sa', 'nv', 'bv', 'spa', 'srl', 'gmbh',
]);

/** The first sentence of a paragraph: the first `.`/`!`/`?` followed by a
 *  space and a capital, unless it closes an abbreviation ("Inc.", "U.S.",
 *  "d.b.a."). */
function firstSentence(text: string): string {
  const re = /[.!?](?=\s+["“(]?[A-Z0-9])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(0, m.index);
    const word = /([A-Za-z.]+)$/.exec(before)?.[1] ?? '';
    const dotted = /(^|\.)[A-Za-z]$/.test(word) || word.includes('.');
    if (m[0] === '.' && (dotted || ABBREVIATIONS.has(word.toLowerCase()))) continue;
    return text.slice(0, m.index + 1);
  }
  return text;
}

/** The first sentence, cut at a word boundary to 160 characters. */
export function oneLinerOf(description: string | null): string {
  if (!description) return '';
  const firstPara = description.split(/\n/)[0]!.trim();
  const sentence = firstSentence(firstPara);
  if (sentence.length <= ONE_LINER_MAX) return sentence;
  const cut = sentence.slice(0, ONE_LINER_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 80 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/** The partner writes a few country names its own way. */
const COUNTRY_ALIASES: Record<string, string> = {
  'hong kong sar - china': 'HK',
  'taiwan - china': 'TW',
  'macao sar - china': 'MO',
  'democratic republic of congo': 'CD',
  'comoro islands': 'KM',
  'saint vincent': 'VC',
};

/** ISO 3166-1 alpha-2 from the partner's structured country field. */
export function partnerCountry(name: string | null): string | null {
  if (!name) return null;
  return COUNTRY_ALIASES[name.trim().toLowerCase()] ?? countryCodeFromName(name);
}

export function placeOf(city: string | null, country: string | null): string {
  return [city?.trim(), country?.trim()].filter(Boolean).join(', ');
}

/** A website as an absolute https URL, or null. */
export function websiteUrl(raw: string | null): string | null {
  const v = raw?.trim();
  if (!v || !hostOf(v)) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// --- Contact details (PRIVATE) --------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function normalizeEmail(raw: string | null): string | null {
  const v = raw?.trim().toLowerCase();
  return v && EMAIL_RE.test(v) ? v : null;
}

/** As published (the partner already writes an international form), with
 *  whitespace tidied. No E.164 rewrite: there is no reliable country to apply. */
export function normalizePhone(raw: string | null): string | null {
  const v = raw?.trim().replace(/\s+/g, ' ');
  return v && (v.match(/\d/g)?.length ?? 0) >= 6 ? v : null;
}

/** A personal profile URL on LinkedIn, canonicalised, or null. A company page,
 *  a post or a non-LinkedIn host is rejected. */
export function normalizeLinkedIn(raw: string | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const host = hostOf(v);
  if (!host || !isLinkedInHost(host)) return null;
  let path: string;
  try {
    path = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).pathname;
  } catch {
    return null;
  }
  const m = /^\/(in|pub)\/[^/?#]+/i.exec(path);
  return m ? `https://www.linkedin.com${m[0]}` : null;
}

// --- People ---------------------------------------------------------------------

export function toPerson(row: PersonRow, sinceYear: number): NormalizedPerson | null {
  const name = row.name?.trim();
  if (!name) return null;
  const title = row.job_title?.trim() || null;
  const contact = {
    email: normalizeEmail(row.email),
    phone: normalizePhone(row.phone),
    linkedinUrl: normalizeLinkedIn(row.linkedin),
  };
  return {
    externalId: `${row.contact_id}:${row.firm_id}`,
    name,
    // A free-text title is a role string, never a RoleKind.
    role: title ?? 'Staff',
    title,
    kind: null,
    since: sinceYear,
    // The PUBLIC LinkedIn column stays empty: the partner's links are private.
    linkedinUrl: null,
    identifiers: [pid(row.contact_id)],
    identifierOnly: true,
    ...(contact.email || contact.phone || contact.linkedinUrl ? { contact } : {}),
  };
}

// --- Firms ----------------------------------------------------------------------

/** `focus`: the firm's normalized focus roles (`toFirmFocusList`); set on the
 *  firm only when there is at least one. */
export function toInvestorFirm(
  firm: FirmRow,
  type: InvestorType,
  people: PersonRow[],
  sinceYear: number,
  focus: readonly NormalizedInvestorFocus[] = [],
): NormalizedInvestorFirm {
  const site = websiteUrl(firm.website);
  return {
    ...(focus.length > 0 ? { focus: [...focus] } : {}),
    externalId: firm.firm_id,
    name: firm.name.trim(),
    type,
    hq: placeOf(firm.city, firm.country) || null,
    countryCode: partnerCountry(firm.country),
    websiteUrl: site,
    domain: identifyingDomain(site),
    description: cleanProse(firm.about),
    foundedYear: firm.year_established && firm.year_established > 1600 ? firm.year_established : null,
    assetsUsd: firm.aum_usd != null && firm.aum_usd > 0 ? firm.aum_usd : null,
    identifiers: [pid(firm.firm_id)],
    people: people.map((p) => toPerson(p, sinceYear)).filter((p): p is NormalizedPerson => p !== null),
  };
}

// --- Funds ----------------------------------------------------------------------

/** `skip` drops the fund entirely: it never existed as a fund. */
const FUND_STATUS: Record<string, FundStatus | 'skip' | null> = {
  Closed: 'Closed',
  'Currently Closed': 'Closed',
  Raising: 'Raising',
  'Open to Investment/Raising': 'Raising',
  'Open for Investment': 'Raising',
  Open: 'Raising',
  'First Close': 'First close',
  'Second Close': 'Second close',
  'Third Close': 'Later close',
  'Fourth Close': 'Later close',
  'Fifth Close': 'Later close',
  'Sixth Close': 'Later close',
  Evergreen: 'Evergreen',
  'Open Ended': 'Evergreen',
  'Semi-Open Ended': 'Evergreen',
  Liquidated: 'Liquidated',
  'Open-Ended (Liquidated)': 'Liquidated',
  Announced: 'Announced',
  Estimated: 'Announced',
  'Never Launched': 'skip',
  Abandoned: 'skip',
  Listed: null,
  'De-Listed': null,
  Unknown: null,
};

export function fundStatus(raw: string | null): FundStatus | 'skip' | null {
  return raw ? (FUND_STATUS[raw] ?? null) : null;
}

const FUND_STRATEGY: Record<string, FundStrategy> = {
  'Venture Capital': 'Venture capital',
  'Private Equity': 'Private equity',
  'Real Estate': 'Real estate',
  'Hedge Funds': 'Hedge fund',
  'Private Debt': 'Other',
  Infrastructure: 'Other',
  'Natural Resources': 'Other',
  Multi: 'Other',
};

export function fundStrategy(assetClass: string | null): FundStrategy | null {
  return assetClass ? (FUND_STRATEGY[assetClass] ?? null) : null;
}

const isoDay = (d: string | null): string | null => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const positive = (n: number | null): number | null => (n != null && n > 0 ? n : null);
/** A percentage as published; a nonsensical one (negative, ≥ 100) is null. */
const pct = (n: number | null): number | null => (n != null && n >= 0 && n < 100 ? n : null);

/** Null when the fund must be dropped (never launched, or its manager is not
 *  an investor we keep). `mandate` (stage v3) is attached when given. */
export function toFund(
  row: FundRow,
  keptFirms: ReadonlyMap<string, KeptFirm>,
  mandate?: NormalizedFundMandate | null,
): NormalizedFund | null {
  const status = fundStatus(row.status);
  if (status === 'skip') return null;
  if (!keptFirms.has(row.manager_id)) return null;
  return {
    ...(mandate ? { mandate } : {}),
    externalId: row.fund_id,
    name: row.name.trim(),
    manager: firmRef(row.manager_id),
    strategy: fundStrategy(row.asset_class),
    status,
    vintageYear: row.vintage && row.vintage > 1900 ? row.vintage : null,
    targetUsd: positive(row.target_usd),
    closedUsd: positive(row.size_usd),
    hardCapUsd: positive(row.hard_cap_usd),
    launchDate: isoDay(row.launch_date),
    latestCloseDate: isoDay(row.latest_close_date),
    finalCloseDate: isoDay(row.final_close_date),
    managementFeePct: pct(row.mgmt_fee_pct),
    carriedInterestPct: pct(row.carry_pct),
    hurdleRatePct: pct(row.hurdle_pct),
    targetIrrNetMinPct: pct(row.irr_net_min),
    targetIrrNetMaxPct: pct(row.irr_net_max),
    targetIrrGrossMinPct: pct(row.irr_gross_min),
    targetIrrGrossMaxPct: pct(row.irr_gross_max),
    regionFocus: row.region_focus?.trim() || null,
    hq: placeOf(row.city, row.country) || null,
  };
}

// --- Money ----------------------------------------------------------------------

/** The partner's currency code as ISO 4217, or null. */
export function currencyCode(raw: string | null): string | null {
  const v = raw?.trim().toUpperCase();
  if (!v) return null;
  if (v === 'RMB') return 'CNY';
  return /^[A-Z]{3}$/.test(v) ? v : null;
}

/** USD for a local amount on a date: the ECB rate, else null. */
export function toUsd(
  amountLocal: number | null,
  currency: string | null,
  isoDate: string,
  fx: FxTable,
): number | null {
  if (amountLocal == null || !currency) return null;
  const rate = fx.usdPer(currency, isoDate);
  return rate == null ? null : amountLocal * rate;
}

// --- Investor focus (stage v2) ---------------------------------------------------

/** Above this a reported cheque or commitment is a unit error, not a range
 *  (one $23M firm reports a $5.7tn maximum). */
export const FOCUS_RANGE_MAX_USD = 10_000_000_000;

/** Labels longer than this are not a vocabulary entry (none today; the longest
 *  is 53 characters). */
const FOCUS_LABEL_MAX = 80;

/** Placeholder labels: not a statement of focus. Compared lowercased. */
const JUNK_LABELS = new Set(['unknown', 'other', 'others', 'n/a', 'none', 'not specified']);

export type FocusIssue = 'amount-invalid' | 'range-implausible' | 'range-inverted' | 'labels-dropped';
export const FOCUS_ISSUES: readonly FocusIssue[] = [
  'amount-invalid',
  'range-implausible',
  'range-inverted',
  'labels-dropped',
];
export type FocusIssueCounts = Record<FocusIssue, number>;
export const emptyFocusIssues = (): FocusIssueCounts => ({
  'amount-invalid': 0,
  'range-implausible': 0,
  'range-inverted': 0,
  'labels-dropped': 0,
});

function cleanLabels(raw: readonly (string | null)[] | null): { labels: string[]; dropped: number } {
  const labels: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const r of raw ?? []) {
    const v = r?.replace(/\s+/g, ' ').trim() ?? '';
    const key = v.toLowerCase();
    if (!v || /^[-–—_.\s]+$/.test(v) || JUNK_LABELS.has(key) || v.length > FOCUS_LABEL_MAX) {
      dropped++;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(v);
  }
  return { labels, dropped };
}

/** Trim, drop blanks and junk (`Unknown`, `Other`, `N/A`, `None`, dashes —
 *  case-insensitive), de-duplicate case-insensitively keeping the first
 *  spelling, keep source order. Labels over 80 chars are dropped (none today). */
export function focusLabels(raw: readonly (string | null)[] | null): string[] {
  return cleanLabels(raw).labels;
}

/** One bound in whole units: millions × 1e6, exactly once, rounded. 0 → absent
 *  ("no bound"); negative / non-finite → invalid. */
export function millionsToUnits(mn: number | null): { value: number | null; invalid: boolean } {
  if (mn == null) return { value: null, invalid: false };
  if (!Number.isFinite(mn) || mn < 0) return { value: null, invalid: true };
  if (mn === 0) return { value: null, invalid: false };
  return { value: Math.round(mn * 1_000_000), invalid: false };
}

export interface NormalizedRange {
  minUsd: number | null;
  maxUsd: number | null;
  currency: string;
  minLocal: number | null;
  maxLocal: number | null;
}

/** The range, or null with the reason it was dropped. Both bounds go when either
 *  is invalid or above FOCUS_RANGE_MAX_USD, or when min > max. Native bounds are
 *  kept only for a valid non-USD currency (`currencyCode`) whose own bounds are
 *  present for exactly the USD bounds present; otherwise USD-only, currency 'USD'.
 *  A USD-reporting firm keeps no local bounds. */
export function focusRange(row: FirmFocusRow): { range: NormalizedRange | null; issue?: FocusIssue } {
  const min = millionsToUnits(row.range_min_usd_mn);
  const max = millionsToUnits(row.range_max_usd_mn);
  if (min.invalid || max.invalid) return { range: null, issue: 'amount-invalid' };
  if (min.value == null && max.value == null) return { range: null };
  if ((min.value ?? 0) > FOCUS_RANGE_MAX_USD || (max.value ?? 0) > FOCUS_RANGE_MAX_USD) {
    return { range: null, issue: 'range-implausible' };
  }
  if (min.value != null && max.value != null && min.value > max.value) {
    return { range: null, issue: 'range-inverted' };
  }
  const usdOnly: NormalizedRange = { minUsd: min.value, maxUsd: max.value, currency: 'USD', minLocal: null, maxLocal: null };

  const currency = currencyCode(row.range_currency);
  if (!currency || currency === 'USD') return { range: usdOnly };
  const lmin = millionsToUnits(row.range_min_local_mn);
  const lmax = millionsToUnits(row.range_max_local_mn);
  const linesUp =
    !lmin.invalid &&
    !lmax.invalid &&
    (lmin.value != null) === (min.value != null) &&
    (lmax.value != null) === (max.value != null) &&
    !(lmin.value != null && lmax.value != null && lmin.value > lmax.value);
  if (!linesUp) return { range: usdOnly };
  return { range: { ...usdOnly, currency, minLocal: lmin.value, maxLocal: lmax.value } };
}

/** One role's normalized focus, or null when it states nothing usable. An LP
 *  row's stages and main strategy are ignored (the publisher reports neither
 *  for LPs). */
export function toFirmFocus(
  row: FirmFocusRow,
  snapshotDate: string,
): { focus: NormalizedInvestorFocus | null; issues: FocusIssue[] } {
  const issues: FocusIssue[] = [];
  const manager = row.role === 'manager';
  let dropped = 0;
  const take = (raw: readonly (string | null)[] | null) => {
    const r = cleanLabels(raw);
    dropped += r.dropped;
    return r.labels;
  };
  const stages = manager ? take(row.stages) : [];
  const mainStrategy = manager ? (take(row.main_strategy == null ? null : [row.main_strategy])[0] ?? null) : null;
  const strategies = take(row.strategies);
  const industries = take(row.industries);
  const verticals = take(row.verticals);
  const geographies = take(row.geographies);
  if (dropped > 0) issues.push('labels-dropped');

  const { range, issue } = focusRange(row);
  if (issue) issues.push(issue);

  const empty =
    stages.length + strategies.length + industries.length + verticals.length + geographies.length === 0 &&
    mainStrategy == null &&
    range == null;
  if (empty) return { focus: null, issues };
  return {
    focus: {
      role: row.role,
      stages,
      mainStrategy,
      strategies,
      industries,
      verticals,
      geographies,
      rangeMinUsd: range?.minUsd ?? null,
      rangeMaxUsd: range?.maxUsd ?? null,
      rangeCurrency: range?.currency ?? 'USD',
      rangeMinLocal: range?.minLocal ?? null,
      rangeMaxLocal: range?.maxLocal ?? null,
      reportedOn: isoDay(row.reported_on) ?? snapshotDate,
      snapshotDate,
    },
    issues,
  };
}

/** A firm's focus rows → its usable roles, tallying every issue into `tally`. */
export function toFirmFocusList(
  rows: readonly FirmFocusRow[],
  snapshotDate: string,
  tally: FocusIssueCounts,
): NormalizedInvestorFocus[] {
  const out: NormalizedInvestorFocus[] = [];
  for (const row of rows) {
    const { focus, issues } = toFirmFocus(row, snapshotDate);
    for (const i of issues) tally[i]++;
    if (focus) out.push(focus);
  }
  return out;
}

// --- Fund mandate (stage v3) -----------------------------------------------------

/** The source's two fund-structure values. Seen in the legal-structure field
 *  they are misfiled there, not a legal form. */
const FUND_STRUCTURES = new Set(['commingled', 'separately managed account']);

export type MandateIssue = 'labels-dropped' | 'legal-misfiled';
export const MANDATE_ISSUES: readonly MandateIssue[] = ['labels-dropped', 'legal-misfiled'];
export type MandateIssueCounts = Record<MandateIssue, number>;
export const emptyMandateIssues = (): MandateIssueCounts => ({ 'labels-dropped': 0, 'legal-misfiled': 0 });

/** The doubled suffix one geography carries (`Hong Kong SAR - China SAR - China`). */
const DOUBLED_SAR = / SAR - China SAR - China$/i;

/** Each element re-split on `;` (one exposure list nests a `;` list in an
 *  element), the doubled ` SAR - China` suffix collapsed. Uncleaned. */
function splitGeographies(raw: readonly (string | null)[] | null): string[] {
  const out: string[] = [];
  for (const r of raw ?? []) {
    for (const part of (r ?? '').split(';')) out.push(part.trim().replace(DOUBLED_SAR, ' SAR - China'));
  }
  return out;
}

/** Geography labels: re-split, the doubled suffix repaired, then `focusLabels`. */
export function geographyLabels(raw: readonly (string | null)[] | null): string[] {
  return focusLabels(splitGeographies(raw));
}

/** One fund's cleaned mandate, or null when nothing usable is left. Lists go
 *  through `focusLabels` (`Diversified` and `Global` are statements and stay);
 *  a legal structure that is really a fund structure is dropped. */
export function toFundMandate(
  row: FundMandateRow,
  snapshotDate: string,
): { mandate: NormalizedFundMandate | null; issues: MandateIssue[] } {
  const issues: MandateIssue[] = [];
  let dropped = 0;
  const take = (raw: readonly (string | null)[] | null) => {
    const r = cleanLabels(raw);
    dropped += r.dropped;
    return r.labels;
  };
  const one = (v: string | null) => (v == null ? null : (take([v])[0] ?? null));

  const detailedStrategy = one(row.detailed_strategy);
  const industries = take(row.industries);
  const verticals = take(row.verticals);
  const geographicFocus = take(splitGeographies(row.geographic_focus));
  const geographicExposure = take(splitGeographies(row.geographic_exposure));
  const domicile = one(row.domicile);
  const structure = one(row.structure);
  let legalStructure = one(row.legal_structure);
  if (legalStructure && FUND_STRUCTURES.has(legalStructure.toLowerCase())) {
    legalStructure = null;
    issues.push('legal-misfiled');
  }
  if (dropped > 0) issues.push('labels-dropped');

  const empty =
    industries.length + verticals.length + geographicFocus.length + geographicExposure.length === 0 &&
    detailedStrategy == null &&
    domicile == null &&
    structure == null &&
    legalStructure == null;
  if (empty) return { mandate: null, issues };
  return {
    mandate: {
      detailedStrategy,
      industries,
      verticals,
      geographicFocus,
      geographicExposure,
      domicile,
      structure,
      legalStructure,
      reportedOn: snapshotDate,
    },
    issues,
  };
}

// --- Companies and deals ---------------------------------------------------------

/** Partner primary industry → canonical sector. Blank or unlisted → null. */
export const PARTNER_SECTOR_MAP: Record<string, Sector> = {
  Software: 'Technology',
  Internet: 'Technology',
  Hardware: 'Technology',
  'IT Infrastructure': 'Technology',
  Semiconductors: 'Technology',
  Electronics: 'Technology',
  'Information Services': 'Technology',
  'IT Security/Cybersecurity': 'Technology',
  'Financial Services': 'Financial services',
  Insurance: 'Financial services',
  Biotechnology: 'Healthcare',
  Pharmaceuticals: 'Healthcare',
  'Medical Devices & Equipment': 'Healthcare',
  Healthcare: 'Healthcare',
  'Healthcare IT': 'Healthcare',
  'Healthcare Specialists': 'Healthcare',
  'Consumer Products': 'Consumer & retail',
  'Consumer Services': 'Consumer & retail',
  Retail: 'Consumer & retail',
  Food: 'Consumer & retail',
  Bottling: 'Consumer & retail',
  'Travel & Leisure': 'Consumer & retail',
  Media: 'Media & telecom',
  'Marketing/Advertising': 'Media & telecom',
  Telecoms: 'Media & telecom',
  'Education/Training': 'Education',
  'Logistics & Distribution': 'Transport',
  'Transportation Services': 'Transport',
  'Automobiles, Other Vehicles & Parts': 'Transport',
  'Rail Transport': 'Transport',
  'Ship Building & Repair': 'Transport',
  'Oil & Gas': 'Energy',
  'Power & Utilities': 'Energy',
  'Renewable Energy': 'Climate',
  'Energy Storage & Batteries': 'Climate',
  'Environmental Services': 'Climate',
  'Real Estate Development & Operating Companies': 'Real estate',
  'Commercial Property': 'Real estate',
  'Industrial Machinery': 'Industrials',
  Materials: 'Industrials',
  Chemicals: 'Industrials',
  Packaging: 'Industrials',
  Aerospace: 'Industrials',
  Defence: 'Industrials',
  'Heating, Cooling & Ventilation Equipment and Services': 'Industrials',
  Mining: 'Industrials',
  'Forestry & Timber': 'Industrials',
  Biopolymers: 'Industrials',
  Construction: 'Industrials',
  Agribusiness: 'Industrials',
  'Business Support Services': 'Industrials',
  Outsourcing: 'Industrials',
};

export interface RoundShape {
  name: string;
  kind: RoundKind;
  /** The name says nothing ("Undisclosed round"). */
  generic: boolean;
}

const SERIES_RE = /^Series ([A-L])$/;

/** Deal stage → round name and kind. Null: not primary capital (a merger, an
 *  add-on acquisition, a secondary sale) — the deal is skipped. */
export function roundFor(stage: string | null): RoundShape | null {
  const s = stage?.trim() ?? '';
  if (SERIES_RE.test(s) || s === 'Seed' || s === 'Angel' || s === 'PIPE' || s === 'Pre-IPO') {
    return { name: s, kind: 'Equity', generic: false };
  }
  switch (s) {
    case 'Growth Capital/Expansion':
      return { name: 'Growth', kind: 'Equity', generic: false };
    case 'Venture Debt':
      return { name: 'Venture debt', kind: 'Debt', generic: false };
    case 'Grant':
      return { name: 'Grant', kind: 'Grant', generic: false };
    case 'Merger':
    case 'Add-on':
    case 'Secondary Stock Purchase':
      return null;
    default:
      // Unspecified Round, blank, <NA>.
      return { name: 'Undisclosed round', kind: 'Equity', generic: true };
  }
}

const SERIES_STAGE: Record<string, Stage> = {
  A: 'Series A',
  B: 'Series B',
  C: 'Series C',
  D: 'Series D',
  E: 'Series E',
  F: 'Series F',
};

/** The company stage a deal stage implies, or null when it implies none. */
function stageOf(dealStage: string | null): Stage | null {
  const s = dealStage?.trim() ?? '';
  if (s === 'Seed' || s === 'Angel') return 'Seed';
  const series = SERIES_RE.exec(s)?.[1];
  if (series) return SERIES_STAGE[series] ?? 'Late stage';
  if (s === 'Growth Capital/Expansion' || s === 'Pre-IPO') return 'Late stage';
  if (s === 'PIPE') return 'Public';
  return null;
}

/**
 * The stage of the latest completed deal that names one. When no deal does
 * (most "Unspecified Round" companies), the SEC source's amount banding on the
 * largest disclosed deal — the same rule Form D companies get.
 */
export function companyStage(deals: DealRow[]): Stage {
  const dated = deals
    .filter((d) => d.deal_date && stageOf(d.stage))
    .sort((a, b) => b.deal_date!.localeCompare(a.deal_date!));
  const named = dated[0] && stageOf(dated[0].stage);
  if (named) return named;
  const largest = Math.max(0, ...deals.map((d) => d.size_usd ?? 0));
  return stageFromAmount(largest);
}

/** A company is imported when it is live or exited and has at least one
 *  completed, dated deal of primary capital. */
const KEPT_COMPANY_STATUS = new Set(['Active', 'Realised']);

/** Whether a deal becomes a round at all: completed, dated, primary capital.
 *  The one eligibility rule — `toRound` and the company-match repair audit
 *  (which must account for every deal ingest would have written) share it. */
export function dealEligible(deal: Pick<DealRow, 'status' | 'deal_date' | 'stage'>): boolean {
  return deal.status === 'Completed' && !!deal.deal_date && roundFor(deal.stage) !== null && !!isoDay(deal.deal_date);
}

/** Whether a company is imported at all (its record also needs a round). */
export function companyKept(status: string | null): boolean {
  return !!status && KEPT_COMPANY_STATUS.has(status);
}

/** The round for one completed deal, or null when it is not one. */
export function toRound(
  deal: DealRow,
  investors: string[],
  keptFirms: ReadonlyMap<string, KeptFirm>,
  fx: FxTable,
): NormalizedRound | null {
  if (!dealEligible(deal)) return null;
  const shape = roundFor(deal.stage)!;
  const date = isoDay(deal.deal_date)!;
  const sizeUsd = positive(deal.size_usd);
  const local = positive(deal.size_local);
  // A blank currency with a USD figure is a USD deal.
  const currency = currencyCode(deal.currency) ?? (sizeUsd != null ? 'USD' : null);

  let amountUsd = 0;
  let amountLocal: number | undefined;
  if (currency === 'USD') {
    amountUsd = sizeUsd ?? local ?? 0;
  } else if (currency && local != null) {
    // The ECB rate on the deal date; before 1999 or for an unquoted currency,
    // the partner's own USD figure.
    amountUsd = toUsd(local, currency, date, fx) ?? sizeUsd ?? 0;
    amountLocal = local;
  } else {
    amountUsd = sizeUsd ?? 0;
  }

  return {
    externalId: deal.deal_id,
    name: shape.name,
    kind: shape.kind,
    date,
    amountUsd: Math.round(amountUsd),
    ...(currency && currency !== 'USD' && amountLocal != null ? { currency, amountLocal } : {}),
    ...(shape.generic ? { genericName: true } : {}),
    investors: [...new Set(investors)].filter((id) => keptFirms.has(id)).map(firmRef),
  };
}

/**
 * The company facts a partner row states besides prose and money: its industry
 * labels (primary industry plus verticals, trimmed and de-duplicated), its
 * location (`Undisclosed` when it names none) and its country. Shared by
 * `toRecord` and the `backfill-partner-company-facts` pass so the two can't
 * drift.
 */
export function companyFacts(company: CompanyRow): { industry: string[]; hq: string; countryCode: string | null } {
  return {
    industry: [
      ...new Set(
        [company.industry, ...(company.verticals ?? '').split(/[;,]/)]
          .map((s) => s?.trim())
          .filter((s): s is string => !!s),
      ),
    ],
    hq: placeOf(company.city, company.country) || 'Undisclosed',
    countryCode: partnerCountry(company.country),
  };
}

/**
 * One company with its rounds and its investors' holdings, or null when the
 * company is not imported (not live/exited, or no completed deal survives).
 */
export function toRecord(
  company: CompanyRow,
  deals: DealRow[],
  dealInvestors: ReadonlyMap<string, string[]>,
  keptFirms: ReadonlyMap<string, KeptFirm>,
  fx: FxTable,
): NormalizedRecord | null {
  if (!company.status || !KEPT_COMPANY_STATUS.has(company.status)) return null;
  const completed = deals.filter((d) => d.status === 'Completed');
  const rounds = completed
    .map((d) => toRound(d, dealInvestors.get(d.deal_id) ?? [], keptFirms, fx))
    .filter((r): r is NormalizedRound => r !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
  if (rounds.length === 0) return null;

  // One holding per firm, across every round it joined.
  const holdings = new Map<string, { first: string; count: number }>();
  for (const r of rounds) {
    for (const ref of r.investors ?? []) {
      const h = holdings.get(ref.externalId);
      if (h) h.count++;
      else holdings.set(ref.externalId, { first: r.name, count: 1 });
    }
  }
  const investors: NormalizedInvestor[] = [...holdings.entries()].map(([firmId, h]) => {
    const firm = keptFirms.get(firmId)!;
    return {
      externalId: `${company.company_id}:${firmId}`,
      investorExternalId: firmId,
      investorIdentifier: pid(firmId),
      name: firm.name,
      type: firm.type,
      firstRound: h.first,
      rounds: h.count,
      onlyIfKnown: true,
    };
  });

  const site = websiteUrl(company.website);
  const description = cleanProse(company.about);
  const { industry, hq, countryCode } = companyFacts(company);

  return {
    source: PARTNER,
    companyExternalId: company.company_id,
    roundDedup: 'enrich',
    company: {
      name: company.name.trim(),
      hq,
      // The snapshot carries no founding year; 0 is the schema's "unknown".
      foundedYear: 0,
      industry,
      stage: companyStage(completed),
      totalRaisedUsd: rounds.filter((r) => r.kind !== 'Grant').reduce((sum, r) => sum + r.amountUsd, 0),
      ...(site ? { websiteUrl: site } : {}),
      ...(identifyingDomain(site) ? { domain: identifyingDomain(site)! } : {}),
      primarySector: company.industry ? (PARTNER_SECTOR_MAP[company.industry] ?? null) : null,
      // Always a string: an absent value would get the SEC placeholder copy.
      oneLiner: oneLinerOf(description),
      description: description ?? '',
      countryCode,
      operatingStatus: company.status === 'Active' ? 'Active' : null,
      identifiers: [pid(company.company_id)],
    },
    rounds,
    investors,
  };
}

// --- Commitments and metrics -----------------------------------------------------

const fundRefOf = (fundId: string, name: string, managerId: string) => ({
  externalId: fundId,
  name: name.trim(),
  manager: firmRef(managerId),
});

/** Null when the committing firm is not an investor we keep. */
export function toCommitment(
  row: CommitmentRow,
  keptFirms: ReadonlyMap<string, KeptFirm>,
  fx: FxTable,
): NormalizedFundCommitment | null {
  if (!keptFirms.has(row.firm_id)) return null;
  const currency = currencyCode(row.fund_currency) ?? 'USD';
  const local = positive(row.amount_local);
  // A commitment is undated; the vintage's mid-year rate is the fair figure.
  const when = row.vintage && row.vintage >= 1999 ? `${row.vintage}-07-01` : '1999-07-01';
  const amountUsd = local == null ? null : currency === 'USD' ? local : toUsd(local, currency, when, fx);
  return {
    externalId: `${row.fund_id}:${row.firm_id}`,
    fund: fundRefOf(row.fund_id, row.fund_name, row.manager_id),
    investor: firmRef(row.firm_id),
    currency,
    amountLocal: currency === 'USD' ? null : local,
    amountUsd: amountUsd == null ? null : Math.round(amountUsd),
  };
}

export function toMetric(row: MetricRow, fx: FxTable): NormalizedFundMetric {
  const asAt = row.as_at;
  const currency = currencyCode(row.fund_currency) ?? 'USD';
  const usd = (v: number | null) => {
    if (v == null) return null;
    const out = currency === 'USD' ? v : toUsd(v, currency, asAt, fx);
    return out == null ? null : Math.round(out);
  };
  return {
    fund: fundRefOf(row.fund_id, row.fund_name, row.manager_id),
    asAt,
    aumUsd: row.aum_usd == null ? null : Math.round(row.aum_usd),
    dryPowderUsd: usd(row.dry_powder_local),
    unrealizedUsd: usd(row.unrealized_local),
  };
}
