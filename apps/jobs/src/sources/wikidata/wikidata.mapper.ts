import type { ExitType, InvestorType, Sector } from '@repo/api';

import type {
  NormalizedAcquisition,
  NormalizedExit,
  NormalizedInvestor,
  NormalizedPerson,
  NormalizedRecord,
} from '../ingestion-source';
import type { SparqlBinding } from './wikidata.client';

export const WIKIDATA = 'WIKIDATA';

/** The five query results for one batch of companies. */
export interface WikidataBundle {
  details: SparqlBinding[];
  investors: SparqlBinding[];
  people: SparqlBinding[];
  acquisitions: SparqlBinding[];
  exits: SparqlBinding[];
}

/** Keyword heuristic mapping Wikidata industry/description text onto the
 *  canonical Sector vocabulary. First match wins — ordering matters: specific
 *  terms (fintech, renewables) sit above their broader buckets (financial
 *  services, energy). Null when nothing fits. */
const SECTOR_RULES: readonly [RegExp, Sector][] = [
  [/artificial intelligence|machine learning/i, 'Artificial intelligence'],
  [/fintech|payment/i, 'Fintech'],
  [/bank|insurance|invest|financial|credit|asset management/i, 'Financial services'],
  [/health|biotech|pharma|medical|hospital/i, 'Healthcare'],
  [/climate|solar|wind power|renewable|carbon|environmental/i, 'Climate'],
  [/oil|gas|petroleum|energy|utilit|sewer|water supply/i, 'Energy'],
  [/software|saas|cloud/i, 'Enterprise SaaS'],
  [/real estate|property|housing|construction|urban planning/i, 'Real estate'],
  [/transport|logistic|airline|railway|shipping|automotive/i, 'Transport'],
  [/retail|restaurant|hotel|tourism|travel|consumer|food/i, 'Consumer & retail'],
  [/telecommunication|media|broadcast|publishing|entertainment/i, 'Media & telecom'],
  [/education|university|school/i, 'Education'],
  [/manufactur|industrial|agricult|forestry|mining|chemical/i, 'Industrials'],
  [/technology|computer|internet|electronics/i, 'Technology'],
];

export function sectorFor(text: string): Sector | null {
  for (const [re, sector] of SECTOR_RULES) {
    if (re.test(text)) return sector;
  }
  return null;
}

/** Map the batched SPARQL bindings into normalized records, one per company
 *  QID that carries an English label. */
export function mapWikidata(bundle: WikidataBundle): NormalizedRecord[] {
  const details = new Map<string, SparqlBinding>();
  for (const b of bundle.details) {
    const qid = qidOf(b.company);
    // Multi-valued properties produce repeated rows — first row wins.
    if (qid && !details.has(qid)) details.set(qid, b);
  }

  const investorsByQid = groupBy(bundle.investors, 'company');
  const peopleByQid = groupBy(bundle.people, 'company');
  const acquisitionsByQid = groupBy(bundle.acquisitions, 'company');
  const exitsByQid = groupBy(bundle.exits, 'company');

  const out: NormalizedRecord[] = [];
  for (const [qid, d] of details) {
    const name = labelOf(d.companyLabel);
    if (!name) continue; // no English label — QID-only rows are useless on the site

    const website = d.website?.value ?? null;
    const domain = hostnameOf(website);
    const linkedinId = d.linkedinId?.value;
    const foundedYear = yearOf(d.inception?.value) ?? 0;
    const hq = [labelOf(d.hqLabel), labelOf(d.countryLabel)].filter(Boolean).join(', ');
    const industryLabel = labelOf(d.industryLabel);

    const investors = mapInvestors(qid, investorsByQid.get(qid) ?? []);
    const people = mapPeople(qid, peopleByQid.get(qid) ?? [], foundedYear);
    const acquisitions = mapAcquisitions(qid, acquisitionsByQid.get(qid) ?? []);
    const exits = mapExits(qid, exitsByQid.get(qid) ?? []);

    const rawDescription = d.companyDescription?.value ?? '';
    const oneLiner = rawDescription
      ? capitalize(rawDescription)
      : `${name} — profile sourced from Wikidata.`;
    const description = buildDescription(name, oneLiner, foundedYear, hq, investors);

    const ipo = exits.some((e) => e.type === 'IPO');
    const acquired = !ipo && exits.some((e) => e.type === 'Acquisition');

    out.push({
      source: WIKIDATA,
      companyExternalId: qid,
      company: {
        name,
        hq: hq || 'Undisclosed',
        foundedYear,
        industry: industryLabel ? [industryLabel] : [],
        // No round data on Wikidata: least-wrong default for notable companies.
        stage: ipo ? 'Public' : acquired ? 'Acquired' : 'Late stage',
        totalRaisedUsd: 0,
        domain,
        websiteUrl: website,
        linkedinUrl: linkedinId ? `https://www.linkedin.com/company/${linkedinId}` : null,
        primarySector: sectorFor(`${industryLabel} ${rawDescription}`),
        oneLiner,
        description,
        headcount: numberOf(d.employees?.value) ?? 0,
        status: ipo ? 'Public' : acquired ? 'Acquired' : 'Private',
      },
      investors,
      people,
      acquisitions,
      exits,
    });
  }
  return out;
}

function mapInvestors(qid: string, rows: SparqlBinding[]): NormalizedInvestor[] {
  const seen = new Set<string>();
  const out: NormalizedInvestor[] = [];
  for (const b of rows) {
    const invQid = qidOf(b.investor);
    const name = labelOf(b.investorLabel);
    if (!invQid || !name || seen.has(invQid)) continue;
    seen.add(invQid);
    out.push({
      externalId: `${qid}:investor:${invQid}`,
      name,
      type: investorTypeFor(name),
      firstRound: 'Undisclosed',
      rounds: 1,
    });
  }
  return out;
}

function investorTypeFor(label: string): InvestorType {
  if (/angel/i.test(label)) return 'Angel';
  if (/private equity/i.test(label)) return 'Private equity';
  return 'Venture';
}

function mapPeople(qid: string, rows: SparqlBinding[], foundedYear: number): NormalizedPerson[] {
  const seen = new Set<string>();
  const out: NormalizedPerson[] = [];
  for (const b of rows) {
    const personQid = qidOf(b.person);
    const name = labelOf(b.personLabel);
    const role = b.role?.value;
    if (!personQid || !name || !role) continue;
    const externalId = `${qid}:person:${personQid}:${role}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    out.push({
      externalId,
      name,
      role,
      since: yearOf(b.start?.value) ?? (foundedYear || new Date().getUTCFullYear()),
    });
  }
  return out;
}

function mapAcquisitions(qid: string, rows: SparqlBinding[]): NormalizedAcquisition[] {
  const seen = new Set<string>();
  const out: NormalizedAcquisition[] = [];
  for (const b of rows) {
    const targetQid = qidOf(b.target);
    const target = labelOf(b.targetLabel);
    const date = isoDateOf(b.date?.value);
    if (!targetQid || !target || !date || seen.has(targetQid)) continue;
    seen.add(targetQid);
    out.push({
      externalId: `${qid}:acq:${targetQid}`,
      target,
      date,
      amountUsd: null,
      rationale: 'Acquisition recorded on Wikidata.',
    });
  }
  return out;
}

function mapExits(qid: string, rows: SparqlBinding[]): NormalizedExit[] {
  const out: NormalizedExit[] = [];
  const seenAcquirers = new Set<string>();
  let ipoDate: string | null = null;

  for (const b of rows) {
    const kind = b.kind?.value;
    const date = isoDateOf(b.date?.value);
    if (kind === 'ipo') {
      // Earliest dated IPO/listing row wins.
      if (date && (!ipoDate || date < ipoDate)) ipoDate = date;
      continue;
    }
    if (kind !== 'acq' || !date) continue;
    const acquirerQid = qidOf(b.acquirer);
    if (!acquirerQid || seenAcquirers.has(acquirerQid)) continue;
    seenAcquirers.add(acquirerQid);
    const acquirer = labelOf(b.acquirerLabel);
    out.push({
      externalId: `${qid}:exit:acq:${acquirerQid}`,
      type: 'Acquisition' satisfies ExitType,
      date,
      valueUsd: null,
      detail: acquirer ? `Acquired by ${acquirer}.` : 'Acquired.',
    });
  }

  if (ipoDate) {
    out.push({
      externalId: `${qid}:exit:ipo`,
      type: 'IPO',
      date: ipoDate,
      valueUsd: null,
      detail: 'Initial public offering.',
    });
  }
  return out;
}

function buildDescription(
  name: string,
  oneLiner: string,
  foundedYear: number,
  hq: string,
  investors: NormalizedInvestor[],
): string {
  const parts = [oneLiner.endsWith('.') ? oneLiner : `${oneLiner}.`];
  if (foundedYear) parts.push(`Founded in ${foundedYear}.`);
  if (hq) parts.push(`Headquartered in ${hq}.`);
  if (investors.length > 0) {
    const names = investors.slice(0, 5).map((i) => i.name);
    const suffix = investors.length > names.length ? ' and others' : '';
    parts.push(`Backed by ${names.join(', ')}${suffix}.`);
  }
  parts.push(`Profile for ${name} enriched from Wikidata.`);
  return parts.join(' ');
}

// --- binding helpers ---------------------------------------------------------

function groupBy(rows: SparqlBinding[], companyVar: string): Map<string, SparqlBinding[]> {
  const map = new Map<string, SparqlBinding[]>();
  for (const b of rows) {
    const qid = qidOf(b[companyVar]);
    if (!qid) continue;
    const list = map.get(qid);
    if (list) list.push(b);
    else map.set(qid, [b]);
  }
  return map;
}

/** QID from an entity URI ('http://www.wikidata.org/entity/Q123' → 'Q123'). */
export function qidOf(term: { value: string } | undefined): string | null {
  const last = term?.value.split('/').pop() ?? '';
  return /^Q\d+$/.test(last) ? last : null;
}

/** English label, or null when the label service echoed the bare QID back. */
function labelOf(term: { value: string } | undefined): string | null {
  const v = term?.value.trim() ?? '';
  return v && !/^Q\d+$/.test(v) ? v : null;
}

function yearOf(dateTime: string | undefined): number | null {
  const y = Number((dateTime ?? '').slice(0, 4));
  return Number.isInteger(y) && y > 0 ? y : null;
}

function isoDateOf(dateTime: string | undefined): string | null {
  const d = (dateTime ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function numberOf(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Hostname of a URL, www.-stripped; '' when absent/unparseable. */
export function hostnameOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
