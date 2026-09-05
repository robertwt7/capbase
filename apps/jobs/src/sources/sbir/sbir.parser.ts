import type { Sector } from '@repo/api';

import { identifyingDomain } from '../../util/domain';
import { kebab } from '../../util/slug';
import { sectorFor } from '../wikidata/wikidata.mapper';
import type {
  NormalizedPerson,
  NormalizedRecord,
  NormalizedRound,
  SourceIdentifier,
} from '../ingestion-source';
import type { SbirRow } from './sbir.client';
import { agencySector, agencyShort } from './agency-sector';

export const SBIR = 'SBIR';

/**
 * Firm identity, best available first.
 *
 * Measured over the whole file: 17,161 distinct UEIs, ZERO of which span more
 * than one normalized firm name; 8 of 21,598 DUNS do. In the ingested slice
 * (any award since 2015) 93% have a UEI and 99.6% have a UEI or DUNS — so the
 * name is a last resort, not the usual key.
 */
export function firmKey(row: SbirRow): string {
  const uei = (row.UEI ?? '').trim().toUpperCase();
  if (uei) return `uei:${uei}`;
  const duns = (row.Duns ?? '').trim().replace(/\D/g, '');
  if (duns) return `duns:${duns}`;
  return `name:${normalizeFirm(row.Company ?? '')}`;
}

/** The identifiers hidden in a firm key. A `name:` key yields none — a
 *  normalized name is not an identifier, and inventing one would join firms
 *  that merely share a spelling. */
function firmIdentifiers(key: string): SourceIdentifier[] {
  if (key.startsWith('uei:')) return [{ scheme: 'UEI', value: key.slice(4) }];
  if (key.startsWith('duns:')) return [{ scheme: 'DUNS', value: key.slice(5) }];
  return [];
}

/** Lowercased, punctuation-collapsed firm name — the fallback identity only. */
function normalizeFirm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One firm's awards, accumulated as the CSV streams past. */
interface FirmAccumulator {
  key: string;
  /** Newest award seen, which supplies the firm's current facts. */
  latest: SbirRow;
  latestYear: number;
  newestYear: number;
  rounds: NormalizedRound[];
  /** Award titles, joined later for the sector keyword pass. */
  titles: string[];
  people: Map<string, NormalizedPerson>;
}

/**
 * Aggregate award rows into one record per firm.
 *
 * A firm is kept when ANY of its awards is from `minYear` or later; all of its
 * awards are then ingested, so an active grantee's history is complete rather
 * than truncated at an arbitrary date.
 */
export class SbirAggregator {
  private readonly firms = new Map<string, FirmAccumulator>();

  constructor(private readonly minYear: number) {}

  add(row: SbirRow): void {
    const key = firmKey(row);
    if (key === 'name:') return; // no company name and no identifier: unusable

    const year = awardYear(row);
    const firm = this.firms.get(key);
    if (!firm) {
      this.firms.set(key, {
        key,
        latest: row,
        latestYear: year,
        newestYear: year,
        rounds: toRound(key, row) ? [toRound(key, row)!] : [],
        titles: [(row['Award Title'] ?? '').trim()].filter(Boolean),
        people: peopleMap(key, row, year),
      });
      return;
    }

    if (year >= firm.latestYear) {
      firm.latest = row;
      firm.latestYear = year;
    }
    if (year > firm.newestYear) firm.newestYear = year;

    const round = toRound(key, row);
    if (round) firm.rounds.push(round);

    const title = (row['Award Title'] ?? '').trim();
    if (title && firm.titles.length < 40) firm.titles.push(title);

    for (const [id, person] of peopleMap(key, row, year)) {
      if (!firm.people.has(id)) firm.people.set(id, person);
    }
  }

  /** Firms with at least one award in the configured window, newest first. */
  records(): NormalizedRecord[] {
    const out: NormalizedRecord[] = [];
    for (const firm of this.firms.values()) {
      if (firm.newestYear < this.minYear) continue;
      out.push(toRecord(firm));
    }
    return out.sort((a, b) => (b.rounds?.length ?? 0) - (a.rounds?.length ?? 0));
  }

  get size(): number {
    return this.firms.size;
  }
}

function toRecord(firm: FirmAccumulator): NormalizedRecord {
  const row = firm.latest;
  const name = (row.Company ?? '').trim() || firm.key;
  const website = (row['Company Website'] ?? '').trim();
  const domain = identifyingDomain(website);
  const industry = [(row.Agency ?? '').trim(), (row.Branch ?? '').trim()].filter(Boolean);

  // Award titles first — an agency that funds everything says nothing — then
  // the agency's own mission as the fallback.
  const primarySector: Sector | null =
    sectorFor(firm.titles.join('. ')) ?? agencySector(row.Agency);

  // Newest award first, so a profile's ladder reads like every other one.
  const rounds = [...firm.rounds].sort((a, b) => b.date.localeCompare(a.date));

  return {
    source: SBIR,
    companyExternalId: firm.key,
    company: {
      name,
      hq: [(row.City ?? '').trim(), (row.State ?? '').trim()].filter(Boolean).join(', '),
      // SBIR does not disclose a founding year; 0 is "not recorded" and lets a
      // later source fill it in.
      foundedYear: 0,
      industry,
      primarySector,
      stage: 'Seed',
      status: 'Private',
      // Grant money is not raised capital, and this column is what the market
      // tape sums. The awards are still on the ladder, tagged Grant.
      totalRaisedUsd: 0,
      ...(domain ? { domain } : {}),
      websiteUrl: normalizeUrl(website),
      headcount: headcount(row),
      oneLiner: oneLiner(firm.rounds.length, row.Agency),
      description: describe(name, firm, row),
      identifiers: firmIdentifiers(firm.key),
    },
    ...(rounds.length ? { rounds } : {}),
    people: [...firm.people.values()],
  };
}

/** One award. `kind: 'Grant'` is the whole point: these are real capital events
 *  that are not raises, so money aggregates skip them. */
function toRound(key: string, row: SbirRow): NormalizedRound | null {
  const amountUsd = Number((row['Award Amount'] ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;

  const date = awardDate(row);
  if (!date) return null;

  // The contract number is the award's public identity; the agency tracking
  // number is the fallback for the ~1% that have no contract recorded.
  const award = (row.Contract ?? '').trim() || (row['Agency Tracking Number'] ?? '').trim();
  if (!award) return null;

  const program = (row.Program ?? '').trim() || 'SBIR';
  const phase = (row.Phase ?? '').trim();
  const agency = agencyShort(row.Agency);

  return {
    externalId: `${key}:${award}`,
    name: [program, phase, 'award', agency ? `(${agency})` : ''].filter(Boolean).join(' '),
    date,
    amountUsd,
    kind: 'Grant',
  };
}

/**
 * Company contacts only. `PI Name` is present on nearly every award but names
 * the principal investigator — a role on the grant, not a role at the company —
 * so it is deliberately skipped.
 */
function peopleMap(key: string, row: SbirRow, year: number): Map<string, NormalizedPerson> {
  const out = new Map<string, NormalizedPerson>();
  const name = (row['Contact Name'] ?? '').replace(/\s+/g, ' ').trim();
  const title = (row['Contact Title'] ?? '').replace(/\s+/g, ' ').trim();
  if (!name || !title) return out;

  const externalId = `${key}:person:${kebab(name)}`;
  out.set(externalId, {
    externalId,
    name,
    role: title,
    title,
    since: year || new Date().getUTCFullYear(),
  });
  return out;
}

/** `Proposal Award Date` when present, else the award year's January. */
function awardDate(row: SbirRow): string {
  const proposal = (row['Proposal Award Date'] ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(proposal)) return proposal;
  const year = awardYear(row);
  return year ? `${year}-01-01` : '';
}

function awardYear(row: SbirRow): number {
  const year = Number((row['Award Year'] ?? '').trim());
  if (Number.isInteger(year) && year > 1900) return year;
  const proposal = (row['Proposal Award Date'] ?? '').trim();
  const fromDate = Number(proposal.slice(0, 4));
  return Number.isInteger(fromDate) && fromDate > 1900 ? fromDate : 0;
}

function headcount(row: SbirRow): number {
  const n = Number((row['Number Employees'] ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function oneLiner(awards: number, agency: string | undefined): string {
  const who = agencyShort(agency);
  const where = who ? ` from ${who} and other federal agencies` : ' from federal agencies';
  return awards === 1
    ? `Won a federal SBIR/STTR research award${where}.`
    : `Won ${awards} federal SBIR/STTR research awards${where}.`;
}

function describe(name: string, firm: FirmAccumulator, row: SbirRow): string {
  const total = firm.rounds.reduce((sum, r) => sum + r.amountUsd, 0);
  const years = firm.rounds.map((r) => r.date.slice(0, 4)).sort();
  const span =
    years.length > 1 && years[0] !== years[years.length - 1]
      ? ` between ${years[0]} and ${years[years.length - 1]}`
      : years.length
        ? ` in ${years[0]}`
        : '';
  const money = total > 0 ? ` totalling $${Math.round(total).toLocaleString('en-US')}` : '';
  const where = (row.State ?? '').trim() ? ` The company is based in ${(row.City ?? '').trim()}, ${(row.State ?? '').trim()}.` : '';
  return (
    `${name} has been awarded ${firm.rounds.length} US Small Business Innovation Research ` +
    `(SBIR/STTR) contract${firm.rounds.length === 1 ? '' : 's'}${money}${span}. ` +
    `These are non-dilutive federal research grants, not equity financing.${where}`
  );
}

function normalizeUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}
