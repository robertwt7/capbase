import type { CompanyStatus, ExitType, InvestorType, Sector, Stage } from '@repo/api';

/** An executive/director/founder attached to a company. */
export interface NormalizedPerson {
  /** Stable within the source, e.g. `${cik}:person:${slug}`. */
  externalId: string;
  name: string;
  role: string;
  since: number;
  title?: string | null;
  linkedinUrl?: string | null;
}

/** An investor holding a position in the company (not tied to a round). */
export interface NormalizedInvestor {
  externalId: string;
  name: string;
  type: InvestorType;
  /** 'Undisclosed' when unknown. */
  firstRound: string;
  rounds: number;
}

/** An acquisition the company made. */
export interface NormalizedAcquisition {
  externalId: string;
  target: string;
  /** ISO date — required by the schema; undated deals are dropped upstream. */
  date: string;
  amountUsd?: number | null;
  rationale: string;
}

/** An exit event (IPO / acquisition) for the company itself. */
export interface NormalizedExit {
  externalId: string;
  type: ExitType;
  date: string;
  valueUsd?: number | null;
  detail: string;
}

/**
 * A source-agnostic, normalized record. Each ingestion source (SEC EDGAR,
 * Wikidata; OpenCorporates later) maps its raw data into this shape so the
 * IngestService can upsert it uniformly.
 */
export interface NormalizedRecord {
  /** Provenance tag, stored on the row for idempotent upserts (e.g. SEC_EDGAR). */
  source: string;
  /** Stable id of the company within the source (e.g. SEC CIK, Wikidata QID). */
  companyExternalId: string;

  company: {
    name: string;
    hq: string;
    foundedYear: number;
    industry: string[];
    stage: Stage;
    /** Total capital raised to date, in USD. */
    totalRaisedUsd: number;
    // Optional metadata a richer source may provide.
    domain?: string;
    websiteUrl?: string | null;
    linkedinUrl?: string | null;
    primarySector?: Sector | null;
    oneLiner?: string;
    description?: string;
    headcount?: number;
    /** Defaults to 'Private'. */
    status?: CompanyStatus;
  };

  round?: {
    /** Stable id of this specific filing/round within the source (e.g. accession). */
    externalId: string;
    name: string;
    /** ISO date (YYYY-MM-DD). */
    date: string;
    amountUsd: number;
  };

  people?: NormalizedPerson[];
  investors?: NormalizedInvestor[];
  acquisitions?: NormalizedAcquisition[];
  exits?: NormalizedExit[];
}

export const INGESTION_SOURCES = Symbol('INGESTION_SOURCES');

export interface FetchOptions {
  /** How many calendar days back to look (sources without a time axis may ignore it). */
  days: number;
  /** Max records to return. */
  limit: number;
}

/** Contract every ingestion source implements. */
export interface IngestionSource {
  readonly name: string;
  fetch(opts: FetchOptions): Promise<NormalizedRecord[]>;
}
