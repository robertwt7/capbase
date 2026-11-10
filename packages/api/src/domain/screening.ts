// Company screening: the directory's advanced criteria (scale ranges, one
// matching financing, an investor) as one shared, versioned contract. The API
// validates and applies it, the web parses and serialises it, and saved
// searches persist it as it is (`companyQueryToParams`, `COMPANY_QUERY_VERSION`).
// Pure: no I/O, no clock — `resolveRoundWindow` takes `now`.

import { ROUND_KINDS, type Company, type RoundKind } from './company';
import type { CompanyListQuery, DirectoryPage } from './pagination';
import type { Citation } from './provenance';
import type { UnlockBy } from './visibility';

/** Rolling financing windows, resolved against the request's clock. */
export const ROUND_WINDOWS = ['3m', '6m', '12m', '24m', '36m'] as const;
export type RoundWindow = (typeof ROUND_WINDOWS)[number];

/** How an investor relates to a company: any recorded link, or named on the matching financing. */
export const INVESTOR_LINKS = ['any', 'round'] as const;
export type InvestorLink = (typeof INVESTOR_LINKS)[number];

/** Bounds a DTO enforces (and the web form mirrors). */
export const SCREEN_MONEY_MAX = 10_000_000_000_000; // $10tn: well past any real figure, inside Number's safe range
export const SCREEN_FOUNDED_MIN = 1600;
export const SCREEN_FOUNDED_MAX = 2100;
export const SCREEN_HEADCOUNT_MAX = 10_000_000;
/** Longest investor slug accepted. */
export const SCREEN_INVESTOR_MAX = 200;

/** Bumped when a param's meaning changes (saved searches store it). */
export const COMPANY_QUERY_VERSION = 1;

export interface CompanyScreenQuery {
  raisedMin?: number;
  raisedMax?: number;
  valuationMin?: number;
  valuationMax?: number;
  foundedMin?: number;
  foundedMax?: number;
  headcountMin?: number;
  headcountMax?: number;
  roundWithin?: RoundWindow;
  /** YYYY-MM-DD, inclusive. */
  roundFrom?: string;
  /** YYYY-MM-DD, inclusive. */
  roundTo?: string;
  roundKind?: RoundKind;
  roundMin?: number;
  roundMax?: number;
  /** Investor slug. */
  investor?: string;
  investorOn?: InvestorLink;
}

/** Range pairs, keyed by the gate's filter key (`raised` locks raisedMin+raisedMax). */
export const SCREEN_RANGES = {
  raised: ['raisedMin', 'raisedMax'],
  valuation: ['valuationMin', 'valuationMax'],
  founded: ['foundedMin', 'foundedMax'],
  headcount: ['headcountMin', 'headcountMax'],
} as const;

export type ScreenRangeKey = keyof typeof SCREEN_RANGES;
export const SCREEN_RANGE_KEYS = Object.keys(SCREEN_RANGES) as ScreenRangeKey[];

/** The params the `round` filter key covers. */
export const ROUND_PARAMS = ['roundWithin', 'roundFrom', 'roundTo', 'roundKind', 'roundMin', 'roundMax'] as const;

/** Every screening param, in canonical order. */
export const SCREEN_PARAMS = [
  ...SCREEN_RANGE_KEYS.flatMap((k) => SCREEN_RANGES[k]),
  ...ROUND_PARAMS,
  'investor',
  'investorOn',
] as const satisfies readonly (keyof CompanyScreenQuery)[];

const isSet = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/** Whether the range `key` carries a bound. */
export const rangeApplied = (q: CompanyScreenQuery, key: ScreenRangeKey): boolean =>
  SCREEN_RANGES[key].some((p) => isSet(q[p]));

/** Whether any financing criterion is set. */
export const hasRoundCriteria = (q: CompanyScreenQuery): boolean => ROUND_PARAMS.some((p) => isSet(q[p]));

/** Filter keys a query applies (the `applied` map `directoryFilters` takes). */
export function screenApplied(q: CompanyScreenQuery): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of SCREEN_RANGE_KEYS) out[key] = rangeApplied(q, key);
  out.round = hasRoundCriteria(q);
  out.investor = isSet(q.investor);
  return out;
}

/** Whether any screening param is set at all. */
export const hasScreenCriteria = (q: CompanyScreenQuery): boolean => SCREEN_PARAMS.some((p) => isSet(q[p]));

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `s` is a real calendar date written YYYY-MM-DD (`2026-02-30` is not). */
export function isCalendarDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Cross-field rules the DTO decorators can't express. The message names params
 *  only — never a value — so an error can't echo anything back. */
export function validateCompanyScreen(q: CompanyScreenQuery): string | null {
  for (const key of SCREEN_RANGE_KEYS) {
    const [min, max] = SCREEN_RANGES[key];
    const lo = q[min];
    const hi = q[max];
    if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) return `${min} must not exceed ${max}`;
  }
  if (typeof q.roundMin === 'number' && typeof q.roundMax === 'number' && q.roundMin > q.roundMax) {
    return 'roundMin must not exceed roundMax';
  }
  if (isSet(q.roundWithin) && (isSet(q.roundFrom) || isSet(q.roundTo))) {
    return 'Use roundWithin or roundFrom/roundTo, not both';
  }
  for (const p of ['roundFrom', 'roundTo'] as const) {
    const v = q[p];
    if (isSet(v) && !isCalendarDate(v as string)) return `${p} must be a real date (YYYY-MM-DD)`;
  }
  if (isSet(q.roundFrom) && isSet(q.roundTo) && (q.roundFrom as string) > (q.roundTo as string)) {
    return 'roundFrom must not be after roundTo';
  }
  if (isSet(q.investorOn) && !isSet(q.investor)) return 'investorOn needs investor';
  return null;
}

const MONTHS: Record<RoundWindow, number> = { '3m': 3, '6m': 6, '12m': 12, '24m': 24, '36m': 36 };

/** Midnight UTC of the same day `months` earlier, clamped to the month's last
 *  day (3 months before 31 May is 28 Feb, or 29 Feb in a leap year). */
export function monthsBefore(now: Date, months: number): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(now.getUTCDate(), lastDay)));
}

const dayStart = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const nextDay = (s: string): Date => new Date(dayStart(s).getTime() + 86_400_000);

/** The financing window as half-open UTC bounds [from, toExclusive), or null.
 *  Rolling: from = start of (today − N months) UTC, toExclusive = now (a
 *  future-dated round never matches "the past N months"). Fixed: from =
 *  roundFrom 00:00Z, toExclusive = (roundTo + 1 day) 00:00Z; either side may be
 *  open. Assumes a query `validateCompanyScreen` accepted. */
export function resolveRoundWindow(
  q: CompanyScreenQuery,
  now: Date,
): { from?: Date; toExclusive?: Date } | null {
  if (q.roundWithin) return { from: monthsBefore(now, MONTHS[q.roundWithin]), toExclusive: now };
  if (!q.roundFrom && !q.roundTo) return null;
  return {
    ...(q.roundFrom && { from: dayStart(q.roundFrom) }),
    ...(q.roundTo && { toExclusive: nextDay(q.roundTo) }),
  };
}

/** Canonical param order for every company-directory param except `page`
 *  (the saved-searches contract: no page offsets). */
export const COMPANY_QUERY_PARAMS = [
  'q',
  'sector',
  'stage',
  'status',
  'country',
  ...SCREEN_PARAMS,
  'sort',
] as const satisfies readonly (keyof CompanyListQuery)[];

/** Serialise in canonical order, dropping empty values (and `investorOn=any`,
 *  the default). `page`, `pageSize`, `slugs` and `domain` are never written. */
export function companyQueryToParams(q: CompanyListQuery): URLSearchParams {
  const out = new URLSearchParams();
  for (const p of COMPANY_QUERY_PARAMS) {
    const v = q[p];
    if (!isSet(v)) continue;
    if (p === 'investorOn' && v === 'any') continue;
    if (p === 'sort' && v === 'name') continue;
    out.set(p, String(v));
  }
  return out;
}

const RANGE_BOUNDS: Record<ScreenRangeKey | 'round', [number, number]> = {
  raised: [0, SCREEN_MONEY_MAX],
  valuation: [0, SCREEN_MONEY_MAX],
  founded: [SCREEN_FOUNDED_MIN, SCREEN_FOUNDED_MAX],
  headcount: [0, SCREEN_HEADCOUNT_MAX],
  round: [0, SCREEN_MONEY_MAX],
};

const intIn = (v: string | undefined, [lo, hi]: [number, number]): number | undefined => {
  if (v === undefined || !/^\d+$/.test(v.trim())) return undefined;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) && n >= lo && n <= hi ? n : undefined;
};

const pickOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.includes(v as T) ? (v as T) : undefined;

/**
 * Lenient URL → screening query (the web's directory and saved searches). A
 * malformed value is dropped rather than forwarded (the API would 400), and
 * the cross-field rules degrade instead of failing: an inverted pair drops
 * both bounds, `roundWithin` wins over fixed dates, an unreal or inverted date
 * pair drops both, and `investorOn` without `investor` is dropped. The result
 * always passes `validateCompanyScreen`.
 */
export function parseCompanyScreen(get: (param: string) => string | undefined): CompanyScreenQuery {
  const out: CompanyScreenQuery = {};
  const pair = (min: keyof CompanyScreenQuery, max: keyof CompanyScreenQuery, bounds: [number, number]) => {
    const lo = intIn(get(min), bounds);
    const hi = intIn(get(max), bounds);
    if (lo !== undefined && hi !== undefined && lo > hi) return;
    if (lo !== undefined) (out as Record<string, number>)[min] = lo;
    if (hi !== undefined) (out as Record<string, number>)[max] = hi;
  };
  for (const key of SCREEN_RANGE_KEYS) pair(SCREEN_RANGES[key][0], SCREEN_RANGES[key][1], RANGE_BOUNDS[key]);
  pair('roundMin', 'roundMax', RANGE_BOUNDS.round);

  const within = pickOf(get('roundWithin'), ROUND_WINDOWS);
  if (within) {
    out.roundWithin = within;
  } else {
    const from = get('roundFrom')?.trim();
    const to = get('roundTo')?.trim();
    const okFrom = from && isCalendarDate(from) ? from : undefined;
    const okTo = to && isCalendarDate(to) ? to : undefined;
    if (!(okFrom && okTo && okFrom > okTo)) {
      if (okFrom) out.roundFrom = okFrom;
      if (okTo) out.roundTo = okTo;
    }
  }
  const kind = pickOf(get('roundKind'), ROUND_KINDS);
  if (kind) out.roundKind = kind;

  const investor = get('investor')?.trim().slice(0, SCREEN_INVESTOR_MAX);
  if (investor) {
    out.investor = investor;
    const on = pickOf(get('investorOn'), INVESTOR_LINKS);
    if (on) out.investorOn = on;
  }
  return out;
}

// --- Response -----------------------------------------------------------------

/** The latest round that satisfied the financing criteria, for one directory row. */
export interface MatchedRound {
  id: string;
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  kind: RoundKind;
  amountUsd: number;
  currency: string;
  amountLocal: number | null;
  citation: Citation | null;
  masked?: string[];
  maskedUnlock?: Record<string, UnlockBy>;
}

/** What the investor filter actually matched on: holdings and rounds, holdings
 *  only (the viewer can't filter on rounds), or the matching financing. */
export type InvestorScope = 'holdingsAndRounds' | 'holdings' | 'round';

export interface CompanyScreenContext {
  /** Resolved investor; null when `investor` was not applied or matched no visible firm. */
  investor: { slug: string; name: string; scope: InvestorScope } | null;
  /** True when `investor` was applied but no visible firm has that slug (the page is empty). */
  investorNotFound: boolean;
  /** The financing window actually applied (YYYY-MM-DD; `to` inclusive, null = open / now). */
  window: { from: string | null; to: string | null } | null;
  /** Latest matching round per row, by company slug (only when the round predicate applied). */
  matches: Record<string, MatchedRound>;
}

/** `GET /companies` and `GET /v1/companies`. */
export interface CompanyDirectoryPage extends DirectoryPage<Company> {
  /** Null when no screening param applied. */
  screen: CompanyScreenContext | null;
}
