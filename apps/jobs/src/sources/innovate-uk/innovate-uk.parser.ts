import { normalizeIdentifier, type RoundKind } from '@repo/api';

import { titleCaseFirm } from '../../util/text';
import type { XlsxRow } from '../../util/xlsx';
import type { NormalizedRecord, NormalizedRound } from '../ingestion-source';

export const INNOVATE_UK = 'INNOVATE_UK';

/** Columns the source cannot work without. A refresh that renames one must
 *  fail the run loudly rather than ingest a corpus of blanks. */
export const REQUIRED_HEADERS = [
  'CRN',
  'Participant Name',
  'Project Number',
  'Award Offered (£)',
  'Project Start Date',
  'Enterprise Size',
  'Participant Withdrawn From Project',
] as const;

/**
 * Businesses only. The rest of the column is Academic, PSO (public sector),
 * RTO, Catapult, Charity, PSRE and "Non UK" — universities and public bodies
 * take most of the money and none of them is a company profile.
 */
const COMPANY_SIZES = new Set(['Micro', 'Small', 'Micro/Small', 'Medium', 'Large']);

/**
 * Participation states that mean no money was committed. Measured on the
 * 2016→present file: Active 23,989, Closed 22,869, Voluntary Withdrawal 96,
 * On Hold 86, Withdrawn 75, Migrated - Withdrawn 53, Pending 47. "Closed" is a
 * FINISHED participation — half of every real award — so this is a deny list
 * of the withdrawn states, never an allow list of "Active".
 */
const NOT_AWARDED = new Set(['Withdrawn', 'Voluntary Withdrawal', 'Migrated - Withdrawn', 'Pending']);

/** USD per GBP on a date, or null when no rate is published for it. */
export interface UsdRates {
  usdPer(currency: string, isoDate: string): number | null;
}

/** Why rows were dropped — logged, so a format change shows up as a count. */
export interface InnovateUkDrops {
  notACompany: number;
  noCrn: number;
  withdrawn: number;
  noAward: number;
  noDate: number;
  noFx: number;
}

interface FirmAccumulator {
  crn: string;
  /** The participation with the latest start, which supplies name and region. */
  latest: XlsxRow;
  latestDate: string;
  firstYear: number;
  /** keyed by round externalId, so a repeated (project, CRN) row sums. */
  rounds: Map<string, NormalizedRound>;
}

/** Excel serial day → ISO date. Serial 1 is 1900-01-01 with Lotus's phantom
 *  29 Feb 1900, which is why the epoch is 1899-12-30. */
export function excelSerialToIso(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

/** The start date as ISO: an Excel serial (how the files store it), an ISO
 *  string, or DD/MM/YYYY. Empty when none of those. */
function startDate(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n > 0 ? excelSerialToIso(n) : '';
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  return dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}` : '';
}

/** "Innovation Loans" are loans; every other product type is grant funding. */
function kindOf(productType: string): RoundKind {
  return /\bloan/i.test(productType) ? 'Debt' : 'Grant';
}

function roundName(productType: string, kind: RoundKind): string {
  if (kind === 'Debt') return 'Innovate UK innovation loan';
  return productType ? `Innovate UK grant — ${productType}` : 'Innovate UK grant';
}

/**
 * Aggregate participation rows into one record per company, keyed by its
 * Companies House number.
 *
 * The CRN is the only identity. There is no name fallback: a participant name
 * is not a structural key, and the ~6k rows without a CRN are mostly
 * universities and public bodies that the size filter drops anyway.
 */
export class InnovateUkAggregator {
  private readonly firms = new Map<string, FirmAccumulator>();
  readonly drops: InnovateUkDrops = {
    notACompany: 0,
    noCrn: 0,
    withdrawn: 0,
    noAward: 0,
    noDate: 0,
    noFx: 0,
  };

  constructor(private readonly fx: UsdRates) {}

  add(row: XlsxRow): void {
    if (!COMPANY_SIZES.has((row['Enterprise Size'] ?? '').trim())) {
      this.drops.notACompany++;
      return;
    }
    const crn = normalizeIdentifier('COMPANIES_HOUSE', row.CRN ?? '');
    if (!crn) {
      this.drops.noCrn++;
      return;
    }
    if (
      NOT_AWARDED.has((row['Participant Withdrawn From Project'] ?? '').trim()) ||
      (row['Project Status'] ?? '').trim() === 'Withdrawn'
    ) {
      this.drops.withdrawn++;
      return;
    }
    const award = Number((row['Award Offered (£)'] ?? '').replace(/[£,\s]/g, ''));
    if (!Number.isFinite(award) || award <= 0) {
      this.drops.noAward++;
      return;
    }
    const date = startDate(row['Project Start Date']);
    if (!date) {
      this.drops.noDate++;
      return;
    }
    const rate = this.fx.usdPer('GBP', date);
    if (rate === null) {
      this.drops.noFx++;
      return;
    }

    const project = (row['Project Number'] ?? '').trim() || (row['Application Number'] ?? '').trim();
    const productType = decodeAmp((row['Innovate UK Product Type'] ?? '').trim());
    const kind = kindOf(productType);
    const externalId = `${project}:${crn}`;

    const firm = this.firms.get(crn) ?? {
      crn,
      latest: row,
      latestDate: date,
      firstYear: Number(date.slice(0, 4)),
      rounds: new Map<string, NormalizedRound>(),
    };
    this.firms.set(crn, firm);
    if (date >= firm.latestDate) {
      firm.latest = row;
      firm.latestDate = date;
    }
    firm.firstYear = Math.min(firm.firstYear, Number(date.slice(0, 4)));

    const existing = firm.rounds.get(externalId);
    if (existing) {
      // The same participant listed twice on one project: both offers are
      // real, and keying them apart would invent a second project.
      existing.amountLocal = (existing.amountLocal ?? 0) + award;
      existing.amountUsd += award * rate;
      if (date < existing.date) existing.date = date;
      return;
    }
    firm.rounds.set(externalId, {
      externalId,
      name: roundName(productType, kind),
      date,
      kind,
      currency: 'GBP',
      amountLocal: award,
      amountUsd: award * rate,
    });
  }

  /** One record per company, most awards first (stable for `limit`). */
  records(): NormalizedRecord[] {
    return [...this.firms.values()]
      .map(toRecord)
      .sort(
        (a, b) =>
          (b.rounds?.length ?? 0) - (a.rounds?.length ?? 0) ||
          a.companyExternalId.localeCompare(b.companyExternalId),
      );
  }

  get size(): number {
    return this.firms.size;
  }
}

function toRecord(firm: FirmAccumulator): NormalizedRecord {
  const row = firm.latest;
  const legalName = (row['Participant Name'] ?? '').replace(/\s+/g, ' ').trim();
  const name = titleCaseFirm(legalName) || firm.crn;
  const region = (row['Address Region'] ?? '').trim();
  const rounds = [...firm.rounds.values()].sort((a, b) => b.date.localeCompare(a.date));
  const n = rounds.length;
  // Loans are raised capital; grants are not (the SBIR rule), so only loans
  // reach the total the market tape sums.
  const totalRaisedUsd = rounds
    .filter((r) => r.kind === 'Debt')
    .reduce((sum, r) => sum + r.amountUsd, 0);

  return {
    source: INNOVATE_UK,
    companyExternalId: firm.crn,
    company: {
      name,
      legalName: legalName || null,
      hq: region ? `${region}, United Kingdom` : 'United Kingdom',
      // A CRN is a Companies House registration: the company is British by
      // construction, whatever its participant name reads like.
      countryCode: 'GB',
      // Not in the dataset; 0 lets Companies House fill it.
      foundedYear: 0,
      industry: [],
      stage: 'Seed',
      status: 'Private',
      companyType: 'For profit',
      totalRaisedUsd,
      oneLiner: 'UK company funded by Innovate UK.',
      description:
        `${name} received ${n} Innovate UK award${n === 1 ? '' : 's'} since ${firm.firstYear}, ` +
        `published in UKRI's funded-projects dataset.`,
      identifiers: [{ scheme: 'COMPANIES_HOUSE', value: firm.crn }],
    },
    rounds,
  };
}

/** The product-type column sometimes arrives with a literal "&amp;". */
function decodeAmp(s: string): string {
  return s.replace(/&amp;/g, '&');
}
