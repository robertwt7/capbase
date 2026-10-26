import { OpsClient, OpsRequestError } from './ops-client';
import { parsePatentPage, summarizePublications, type PatentPublication } from './patent-parser';
import { PATENT_PILOT_SAMPLE, type PatentPilotCompany } from './sample';

export interface PilotOptions {
  companies: number;
  requests: number;
  pages: number;
  since?: string;
}

export function validatePilotOptions(options: PilotOptions): void {
  for (const [name, value, max] of [
    ['companies', options.companies, 25], ['requests', options.requests, 100], ['pages', options.pages, 3],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be between 1 and ${max}`);
  }
  if (options.since && (!/^\d{4}-\d{2}-\d{2}$/.test(options.since) ||
      Number.isNaN(Date.parse(options.since)) || new Date(options.since).toISOString().slice(0, 10) !== options.since)) {
    throw new Error('since must be a valid YYYY-MM-DD publication date');
  }
}

export function applicantQuery(company: PatentPilotCompany, since?: string): string {
  // Names are the reviewed, fixed pilot list; reject CQL metacharacters in future extensions.
  if (/["\\]/.test(company.legalName) || [...company.legalName].some((char) => char.charCodeAt(0) < 32)) {
    throw new Error('Unsafe applicant query');
  }
  return `pa="${company.legalName}"${since ? ` and pd >= ${since.replaceAll('-', '')}` : ''}`;
}

interface CompanyResult {
  company: PatentPilotCompany;
  status: 'RETRIEVED_CANDIDATES' | 'NO_RESULTS_UNCONFIRMED' | 'FAILED';
  query: string;
  totalSearchResults: number | null;
  truncated: boolean;
  skippedRecords: number;
  publications: PatentPublication[];
  newPublicationIds: string[];
  summary: ReturnType<typeof summarizePublications>;
  matching: { status: 'MANUAL_ADJUDICATION_REQUIRED'; publishedLinks: 0; precision: null };
  failure?: { message: string; retryable: boolean; retryAfterSeconds: number | null };
}

export interface PatentPilotReport {
  schemaVersion: 1;
  runAt: string;
  source: 'EPO_OPS';
  status: 'LIVE_ACCESS_UNVERIFIED' | 'CANDIDATES_REQUIRE_ADJUDICATION' | 'SOURCE_ACCESS_FAILED';
  recommendation: 'NO_GO_PENDING_LIVE_EVIDENCE';
  sourceCoverageDate: null;
  options: PilotOptions;
  requests: number;
  bytes: number;
  companies: CompanyResult[];
  reason?: string;
  limitations: string[];
}

export async function runPatentPilot(
  options: PilotOptions,
  credentials: { key?: string; secret?: string },
  previous?: PatentPilotReport,
  client?: Pick<OpsClient, 'authenticate' | 'search' | 'requests' | 'bytes'>,
): Promise<PatentPilotReport> {
  validatePilotOptions(options);
  const report: PatentPilotReport = {
    schemaVersion: 1, runAt: new Date().toISOString(), source: 'EPO_OPS',
    status: 'LIVE_ACCESS_UNVERIFIED', recommendation: 'NO_GO_PENDING_LIVE_EVIDENCE',
    sourceCoverageDate: null, options, requests: 0, bytes: 0, companies: [],
    limitations: [
      'Applicant names are private research candidates, never verified company ownership.',
      'Empty results do not establish zero patents; search result totals are not company totals.',
      'Publication, grant-kind publication and family counts describe retrieved records only.',
      'Grant-kind classification is limited to reviewed EP B1/B2/B3 and US B1/B2 kinds.',
      'Retrieval date and latest publication date do not establish source coverage or update lag.',
      'Publication-date watermarks can miss delayed/backfilled records; compare overlapping runs and full baselines.',
      'Company legal identity references and every applicant match require manual adjudication.',
    ],
  };
  if (!credentials.key || !credentials.secret) {
    report.reason = 'EPO_OPS_CONSUMER_KEY and EPO_OPS_CONSUMER_SECRET are required; no network requests made.';
    return report;
  }
  const ops = client ?? new OpsClient(credentials.key, credentials.secret, options.requests);
  try {
    await ops.authenticate();
  } catch {
    report.status = 'SOURCE_ACCESS_FAILED';
    report.reason = 'EPO authentication failed; credentials and response bodies are never recorded.';
    report.requests = ops.requests;
    report.bytes = ops.bytes;
    return report;
  }
  report.status = 'CANDIDATES_REQUIRE_ADJUDICATION';
  for (const company of PATENT_PILOT_SAMPLE.slice(0, options.companies)) {
    if (ops.requests >= options.requests) break;
    const query = applicantQuery(company, options.since);
    const publications = new Map<string, PatentPublication>();
    const result: CompanyResult = {
      company, status: 'NO_RESULTS_UNCONFIRMED', query, totalSearchResults: null,
      truncated: false, skippedRecords: 0, publications: [], newPublicationIds: [],
      summary: summarizePublications([]),
      matching: { status: 'MANUAL_ADJUDICATION_REQUIRED', publishedLinks: 0, precision: null },
    };
    let end = 0;
    try {
      for (let pageIndex = 0; pageIndex < options.pages && ops.requests < options.requests; pageIndex++) {
        const begin = pageIndex * 25 + 1;
        const page = parsePatentPage(await ops.search(query, begin, begin + 24));
        if (page.totalResults > 0 && (page.begin !== begin || page.end < begin || page.end > begin + 24)) {
          throw new Error('Unexpected OPS pagination range');
        }
        result.totalSearchResults = page.totalResults;
        result.skippedRecords += page.skippedRecords;
        for (const publication of page.publications) publications.set(publication.publicationId, publication);
        end = page.end;
        if (page.totalResults === 0 || end >= page.totalResults) break;
      }
      result.status = publications.size ? 'RETRIEVED_CANDIDATES' : 'NO_RESULTS_UNCONFIRMED';
    } catch (error) {
      result.status = 'FAILED';
      result.failure = {
        message: error instanceof OpsRequestError ? error.message : 'OPS request, XML contract or resource limit failed',
        retryable: error instanceof OpsRequestError && error.retryable,
        retryAfterSeconds: error instanceof OpsRequestError ? error.retryAfterSeconds : null,
      };
    }
    result.publications = [...publications.values()];
    result.summary = summarizePublications(result.publications);
    result.truncated = result.totalSearchResults === null || end < result.totalSearchResults;
    const prior = previous?.companies.find((item) => item.company.key === company.key &&
      item.company.legalName === company.legalName && item.company.jurisdiction === company.jurisdiction);
    const priorIds = new Set(prior?.publications.map((item) => item.publicationId) ?? []);
    result.newPublicationIds = result.publications.map((item) => item.publicationId).filter((id) => !priorIds.has(id));
    report.companies.push(result);
    // A source-wide failure should not trigger another 24 identical failures.
    if (result.failure && (result.failure.retryable || ops.requests >= options.requests)) break;
  }
  report.requests = ops.requests;
  report.bytes = ops.bytes;
  if (report.companies.length === 0 || report.companies.every((company) => company.status === 'FAILED')) {
    report.status = 'SOURCE_ACCESS_FAILED';
  }
  return report;
}
