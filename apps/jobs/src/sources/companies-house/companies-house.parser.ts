import { normalizeIdentifier, type Stage } from '@repo/api';

import type { CsvRow } from '../../util/csv';
import { titleCaseFirm } from '../../util/text';
import type { NormalizedRecord } from '../ingestion-source';
import { sectorFromSic } from './sic-sector';

export const COMPANIES_HOUSE = 'COMPANIES_HOUSE';

/**
 * Account categories filed only by companies past the small-company thresholds
 * (with exceptions — a small company may elect FULL). There is no official list
 * of private companies by size; this is the closest public proxy. Measured on
 * part 1 of the 2026-10 snapshot: FULL 12,605, GROUP 3,910, MEDIUM 927 of
 * 849,999 rows — ≈110k nationally. Everything else is MICRO ENTITY, TOTAL
 * EXEMPTION, DORMANT or NO ACCOUNTS FILED.
 */
const SIZE_SLICE_ACCOUNTS = new Set(['FULL', 'GROUP', 'MEDIUM']);

/** Share-capital companies only: guarantee companies, LLPs, LPs, charities and
 *  CICs are a different kind of entity from the ones a funding database is for. */
const COMPANY_CATEGORIES = new Set(['Private Limited Company', 'Public Limited Company']);

const PLC = 'Public Limited Company';

export type KeepReason = 'known' | 'slice';

/**
 * Why to keep a register row, or null to skip it.
 *
 * `known` beats every filter: a number we already hold (an Innovate UK grantee,
 * a Wikidata company's P2622) is enriched whatever its size or status, because
 * the row exists on our side already and the register is its best source.
 */
export function keepReason(row: CsvRow, known: ReadonlySet<string>): KeepReason | null {
  const number = normalizeIdentifier('COMPANIES_HOUSE', row.CompanyNumber ?? '');
  if (!number) return null;
  if (known.has(number)) return 'known';
  if (
    SIZE_SLICE_ACCOUNTS.has((row['Accounts.AccountCategory'] ?? '').trim()) &&
    (row.CompanyStatus ?? '').trim().startsWith('Active') &&
    COMPANY_CATEGORIES.has((row.CompanyCategory ?? '').trim())
  ) {
    return 'slice';
  }
  return null;
}

/** `DD/MM/YYYY` → ISO, or null. */
function registerDate(raw: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((raw ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Title-case a post town ("MILTON KEYNES" → "Milton Keynes"); towns carry no
 *  legal-form tokens, so the firm rules would only get in the way. */
function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** SIC texts with their "NNNNN - " prefix stripped; "None Supplied" dropped. */
function industries(row: CsvRow): string[] {
  const out: string[] = [];
  for (const key of ['SICCode.SicText_1', 'SICCode.SicText_2', 'SICCode.SicText_3', 'SICCode.SicText_4']) {
    const text = (row[key] ?? '').trim();
    if (!text || /^none supplied$/i.test(text)) continue;
    const label = text.replace(/^\d{4,5}\s*-\s*/, '').trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * One register row as a company record. No rounds and no people: the free
 * register carries neither (officers are a separate, request-only product).
 */
export function toRecord(row: CsvRow, reason: KeepReason): NormalizedRecord {
  const number = normalizeIdentifier('COMPANIES_HOUSE', row.CompanyNumber ?? '')!;
  const legalName = (row.CompanyName ?? '').replace(/\s+/g, ' ').trim();
  const name = titleCaseFirm(legalName) || number;
  const category = (row.CompanyCategory ?? '').trim();
  const isPlc = category === PLC;
  const active = (row.CompanyStatus ?? '').trim().startsWith('Active');
  const town = (row['RegAddress.PostTown'] ?? '').trim();
  const incorporated = registerDate(row.IncorporationDate);
  const year = incorporated ? Number(incorporated.slice(0, 4)) : 0;
  const accounts = (row['Accounts.AccountCategory'] ?? '').trim().toLowerCase();

  // `stage` is non-null in the schema. The register says nothing about
  // funding stage, so this follows the SBIR precedent with the one structural
  // fact it does have: a PLC is public, a FULL/GROUP/MEDIUM filer is past
  // "small", and a known number outside that slice is a small grantee.
  // Enrichment never overwrites stage, so a richer source's value survives.
  const stage: Stage = isPlc ? 'Public' : reason === 'slice' ? 'Late stage' : 'Seed';
  const kind = category ? `${category.toLowerCase()}` : 'company';

  return {
    source: COMPANIES_HOUSE,
    companyExternalId: number,
    company: {
      name,
      legalName: legalName || null,
      hq: town ? `${titleCase(town)}, United Kingdom` : 'United Kingdom',
      // The register is the UK's own: GB by construction. RegAddress.Country
      // is free text ("ENGLAND", "WALES") and adds nothing to that.
      countryCode: 'GB',
      foundedYear: year,
      industry: industries(row),
      primarySector: sectorFromSic(row['SICCode.SicText_1']),
      stage,
      status: isPlc ? 'Public' : 'Private',
      operatingStatus: active ? 'Active' : null,
      companyType: 'For profit',
      totalRaisedUsd: 0,
      oneLiner: year ? `UK ${kind} incorporated ${year}.` : `UK ${kind}.`,
      description:
        `${name} is a UK ${kind} registered at Companies House (${number})` +
        (incorporated ? `, incorporated ${incorporated}` : '') +
        (accounts && !accounts.startsWith('no accounts') ? `, filing ${accounts} accounts` : '') +
        '.',
      identifiers: [{ scheme: 'COMPANIES_HOUSE', value: number }],
    },
  };
}
