// The Filters sheet's draft: string-only values (the forms convention), parsed
// and cross-checked here, mapped to the shared `CompanyScreenQuery` contract.
// The API re-validates everything (`validateCompanyScreen`); this only keeps a
// bad draft from navigating at all.

import {
  INVESTOR_LINKS,
  ROUND_KINDS,
  ROUND_WINDOWS,
  SCREEN_FOUNDED_MAX,
  SCREEN_FOUNDED_MIN,
  SCREEN_HEADCOUNT_MAX,
  SCREEN_MONEY_MAX,
  isCalendarDate,
  validateCompanyScreen,
  type CompanyScreenQuery,
  type InvestorLink,
  type RoundKind,
  type RoundWindow,
} from '@repo/api';
import { z } from 'zod';

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, t: 1e12 };

/**
 * A money amount as people type it — `5M`, `500k`, `1.5b`, `$5,000,000`,
 * `2 500 000` — to whole USD. Undefined for an empty input; null when it is
 * not an amount (or out of range).
 */
export function parseMoneyInput(raw: string): number | null | undefined {
  const s = raw.trim().toLowerCase().replace(/^\$/, '').replace(/[,\s_]/g, '');
  if (s === '') return undefined;
  const m = /^(\d+(?:\.\d+)?)(k|m|b|bn|t)?$/.exec(s);
  if (!m) return null;
  const n = Math.round(Number(m[1]) * (m[2] ? SUFFIX[m[2]]! : 1));
  return Number.isSafeInteger(n) && n >= 0 && n <= SCREEN_MONEY_MAX ? n : null;
}

/** A whole number within bounds; undefined for empty, null when invalid. */
export function parseIntInput(raw: string, min: number, max: number): number | null | undefined {
  const s = raw.trim().replace(/,/g, '');
  if (s === '') return undefined;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** "Any time", a rolling window, or custom dates. */
export const WINDOW_CHOICES = ['any', ...ROUND_WINDOWS, 'custom'] as const;
export type WindowChoice = (typeof WINDOW_CHOICES)[number];

export const screenFormSchema = z
  .object({
    raisedMin: z.string(),
    raisedMax: z.string(),
    valuationMin: z.string(),
    valuationMax: z.string(),
    foundedMin: z.string(),
    foundedMax: z.string(),
    headcountMin: z.string(),
    headcountMax: z.string(),
    window: z.enum(WINDOW_CHOICES),
    roundFrom: z.string(),
    roundTo: z.string(),
    roundKind: z.enum(['any', ...ROUND_KINDS] as [string, ...string[]]),
    roundMin: z.string(),
    roundMax: z.string(),
    investor: z.string(),
    investorName: z.string(),
    investorOn: z.enum(INVESTOR_LINKS),
  })
  .superRefine((v, ctx) => {
    let issues = 0;
    const issue = (path: keyof ScreenFormValues, message: string) => {
      issues++;
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const money = ['raisedMin', 'raisedMax', 'valuationMin', 'valuationMax', 'roundMin', 'roundMax'] as const;
    for (const f of money) {
      if (parseMoneyInput(v[f]) === null) issue(f, 'Enter an amount such as 5M, 500k or 2,000,000.');
    }
    for (const f of ['foundedMin', 'foundedMax'] as const) {
      if (parseIntInput(v[f], SCREEN_FOUNDED_MIN, SCREEN_FOUNDED_MAX) === null) {
        issue(f, `Enter a year from ${SCREEN_FOUNDED_MIN} to ${SCREEN_FOUNDED_MAX}.`);
      }
    }
    for (const f of ['headcountMin', 'headcountMax'] as const) {
      if (parseIntInput(v[f], 0, SCREEN_HEADCOUNT_MAX) === null) issue(f, 'Enter a whole number.');
    }
    if (v.window === 'custom') {
      for (const f of ['roundFrom', 'roundTo'] as const) {
        if (v[f].trim() && !isCalendarDate(v[f].trim())) issue(f, 'Enter a date.');
      }
      if (!v.roundFrom.trim() && !v.roundTo.trim()) issue('roundFrom', 'Pick a start date, an end date, or both.');
    }
    // Cross-field rules, on the mapped values, through the shared validator.
    const q = toScreenQuery(v);
    const pairs = [
      ['raisedMin', 'raisedMax'],
      ['valuationMin', 'valuationMax'],
      ['foundedMin', 'foundedMax'],
      ['headcountMin', 'headcountMax'],
      ['roundMin', 'roundMax'],
    ] as const;
    for (const [min, max] of pairs) {
      const lo = q[min];
      const hi = q[max];
      if (lo !== undefined && hi !== undefined && lo > hi) issue(max, 'Must not be below the minimum.');
    }
    if (q.roundFrom && q.roundTo && q.roundFrom > q.roundTo) issue('roundTo', 'Must not be before the start date.');
    const backstop = validateCompanyScreen(q);
    if (backstop && issues === 0) issue('raisedMin', backstop);
  });

export type ScreenFormValues = z.infer<typeof screenFormSchema>;

/** A whole-USD amount in the compact form people type (5000000 → `5M`,
 *  2500000 → `2.5M`), exact or not at all — `parseMoneyInput` reads it back. */
export function moneyInputOf(n: number | undefined): string {
  if (n === undefined) return '';
  for (const [unit, size] of [['B', 1e9], ['M', 1e6], ['k', 1e3]] as const) {
    if (n >= size) {
      const v = n / size;
      if (Number.isInteger(v * 100)) return `${v}${unit}`;
    }
  }
  return String(n);
}

/** The query → the draft (the investor's display name comes from the API's `screen`). */
export function toScreenFormValues(q: CompanyScreenQuery, investorName = ''): ScreenFormValues {
  const s = (n: number | undefined) => (n === undefined ? '' : String(n));
  return {
    raisedMin: moneyInputOf(q.raisedMin),
    raisedMax: moneyInputOf(q.raisedMax),
    valuationMin: moneyInputOf(q.valuationMin),
    valuationMax: moneyInputOf(q.valuationMax),
    foundedMin: s(q.foundedMin),
    foundedMax: s(q.foundedMax),
    headcountMin: s(q.headcountMin),
    headcountMax: s(q.headcountMax),
    window: q.roundWithin ?? (q.roundFrom || q.roundTo ? 'custom' : 'any'),
    roundFrom: q.roundFrom ?? '',
    roundTo: q.roundTo ?? '',
    roundKind: q.roundKind ?? 'any',
    roundMin: moneyInputOf(q.roundMin),
    roundMax: moneyInputOf(q.roundMax),
    investor: q.investor ?? '',
    investorName: q.investor ? investorName || q.investor : '',
    investorOn: q.investorOn ?? 'any',
  };
}

export const screenFormDefaults: ScreenFormValues = toScreenFormValues({});

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

/** The draft → the shared contract (only the params it sets). */
export function toScreenQuery(v: ScreenFormValues): CompanyScreenQuery {
  const q: CompanyScreenQuery = {
    raisedMin: opt(parseMoneyInput(v.raisedMin)),
    raisedMax: opt(parseMoneyInput(v.raisedMax)),
    valuationMin: opt(parseMoneyInput(v.valuationMin)),
    valuationMax: opt(parseMoneyInput(v.valuationMax)),
    foundedMin: opt(parseIntInput(v.foundedMin, SCREEN_FOUNDED_MIN, SCREEN_FOUNDED_MAX)),
    foundedMax: opt(parseIntInput(v.foundedMax, SCREEN_FOUNDED_MIN, SCREEN_FOUNDED_MAX)),
    headcountMin: opt(parseIntInput(v.headcountMin, 0, SCREEN_HEADCOUNT_MAX)),
    headcountMax: opt(parseIntInput(v.headcountMax, 0, SCREEN_HEADCOUNT_MAX)),
    roundWithin: v.window !== 'any' && v.window !== 'custom' ? (v.window as RoundWindow) : undefined,
    roundFrom: v.window === 'custom' && v.roundFrom.trim() ? v.roundFrom.trim() : undefined,
    roundTo: v.window === 'custom' && v.roundTo.trim() ? v.roundTo.trim() : undefined,
    roundKind: v.roundKind !== 'any' ? (v.roundKind as RoundKind) : undefined,
    roundMin: opt(parseMoneyInput(v.roundMin)),
    roundMax: opt(parseMoneyInput(v.roundMax)),
    investor: v.investor.trim() || undefined,
    investorOn: v.investor.trim() && v.investorOn === 'round' ? ('round' as InvestorLink) : undefined,
  };
  return Object.fromEntries(Object.entries(q).filter(([, x]) => x !== undefined)) as CompanyScreenQuery;
}
