import type { InvestorType } from '@repo/api';

import type { CsvRow } from '../../util/csv';
import { hostOf, identifyingDomain, isLinkedInHost, isSocialHost } from '../../util/domain';
import { titleCaseFirm } from '../../util/text';
import type { NormalizedInvestorFirm } from '../ingestion-source';

export const SEC_ADV = 'SEC_ADV';

export type AdvRow = CsvRow;

/** Numeric cell → number. Handles space padding, thousands separators and the
 *  bare ".00" the SEC writes for "nothing reported". */
function num(value: string | undefined): number {
  const cleaned = (value ?? '').replace(/[,\s$]/g, '');
  if (!cleaned || cleaned === '.00') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The firm's type, from whichever class of private fund it runs most of.
 *
 * Verified distribution across both July 2026 files: 2,972 Venture /
 * 4,061 Private equity / 3,223 Hedge fund. Null means the firm reports no
 * private funds at all — a wealth manager or similar, not an investor.
 */
export function investorTypeForAdv(row: AdvRow): InvestorType | null {
  const counts: [InvestorType, number][] = [
    ['Venture', num(row['Total number of VC funds'])],
    ['Private equity', num(row['Total number of PE funds'])],
    ['Hedge fund', num(row['Total number of Hedge funds'])],
  ];
  let best = counts[0]!;
  for (const c of counts) if (c[1] > best[1]) best = c;
  if (best[1] > 0) return best[0];

  // Some firms tick "Any X Funds" without filling the count.
  const flagged = (key: string) => (row[key] ?? '').trim().toUpperCase() === 'Y';
  if (flagged('Any VC Funds')) return 'Venture';
  if (flagged('Any PE Funds')) return 'Private equity';
  if (flagged('Any Hedge Funds')) return 'Hedge fund';
  return null;
}

/** Statuses that mean the registration is no longer live. */
function isActive(row: AdvRow): boolean {
  const status = (row['SEC Current Status'] ?? '').toLowerCase();
  if (!status) return false;
  return !/withdraw|terminat|revok|expire|cancel/.test(status);
}

interface Links {
  websiteUrl: string | null;
  linkedinUrl: string | null;
  /** Null whenever the host belongs to a platform rather than the firm. */
  domain: string | null;
}

/**
 * Classify the single "Website Address" cell, which is whatever the filer typed.
 *
 * Three cases matter, all measured in the July 2026 roster:
 *   - 3,295 advisers gave a linkedin.com URL → route to `linkedinUrl`,
 *   -    21 gave the same medium.com blog and 8 their crunchbase.com profile →
 *          keep the link but publish NO domain, or domain matching merges
 *          Founders Fund, Menlo Ventures and Beringea into a single investor,
 *   - other social links say nothing about the firm → drop entirely.
 */
export function classifyAdvWebsite(raw: string | undefined): Links {
  const value = (raw ?? '').trim();
  const host = hostOf(value);
  if (!host) return { websiteUrl: null, linkedinUrl: null, domain: null };

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const normalized = withScheme.replace(/^HTTPS?:\/\//i, (m) => m.toLowerCase());

  if (isLinkedInHost(host)) return { websiteUrl: null, linkedinUrl: normalized, domain: null };
  if (isSocialHost(host)) return { websiteUrl: null, linkedinUrl: null, domain: null };
  // Platform links stay visible on the profile but never become a match key.
  return { websiteUrl: normalized, linkedinUrl: null, domain: identifyingDomain(value) };
}

function hqOf(row: AdvRow): string | null {
  const city = row['Main Office City'] ? titleCaseFirm(row['Main Office City']) : '';
  const state = (row['Main Office State'] ?? '').trim();
  const country = (row['Main Office Country'] ?? '').trim();
  const parts = [city, state, country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

const TYPE_NOUN: Record<string, string> = {
  Venture: 'venture capital firm',
  'Private equity': 'private equity firm',
  'Hedge fund': 'hedge fund manager',
};

function describe(name: string, type: InvestorType, fundCount: number, hq: string | null): string {
  const noun = TYPE_NOUN[type] ?? 'investment firm';
  const where = hq ? ` based in ${hq}` : '';
  const funds =
    fundCount > 0 ? ` It reports ${fundCount} private fund${fundCount === 1 ? '' : 's'} to the SEC.` : '';
  return `${name} is a ${noun}${where}, registered as an investment adviser with the SEC.${funds}`;
}

/**
 * Map roster rows to investor firms. Rows without private funds (ordinary
 * wealth managers) and inactive registrations are dropped.
 *
 * `types` restricts the output to the given InvestorTypes.
 */
export function mapAdvRows(rows: AdvRow[], types: readonly InvestorType[]): NormalizedInvestorFirm[] {
  const out: NormalizedInvestorFirm[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isActive(row)) continue;

    const type = investorTypeForAdv(row);
    if (!type || !types.includes(type)) continue;

    const crd = (row['Organization CRD#'] ?? '').trim();
    if (!crd || seen.has(crd)) continue;

    const rawName = (row['Primary Business Name'] || row['Legal Name'] || '').trim();
    if (!rawName) continue;
    seen.add(crd);

    const name = titleCaseFirm(rawName);
    const legalRaw = (row['Legal Name'] ?? '').trim();
    const legalName = legalRaw && legalRaw !== rawName ? titleCaseFirm(legalRaw) : null;
    const { websiteUrl, linkedinUrl, domain } = classifyAdvWebsite(row['Website Address']);
    const hq = hqOf(row);

    const fundCount =
      num(row['Total number of VC funds']) +
      num(row['Total number of PE funds']) +
      num(row['Total number of Hedge funds']) +
      num(row['Total number of Real Estate funds']) +
      num(row['Total number of Securitized funds']) +
      num(row['Total number of Other funds']);
    const assets = num(row['Total Gross Assets of Private Funds']);
    const cik = (row['CIK#'] ?? '').trim();

    out.push({
      externalId: crd,
      name,
      legalName,
      type,
      hq,
      websiteUrl,
      linkedinUrl,
      domain,
      description: describe(name, type, fundCount, hq),
      crdNumber: crd,
      cikNumber: cik || null,
      fundCount: fundCount > 0 ? fundCount : null,
      assetsUsd: assets > 0 ? assets : null,
      foundedYear: null, // Form ADV does not disclose a founding year.
      // Both are printed on the filing itself, so both are structural.
      identifiers: [
        { scheme: 'CRD' as const, value: crd },
        ...(cik ? [{ scheme: 'CIK' as const, value: cik }] : []),
      ],
    });
  }

  return out;
}
