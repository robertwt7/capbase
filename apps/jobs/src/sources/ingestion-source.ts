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
  /** Identifies this company↔investor holding within the source. */
  externalId: string;
  /** Stable id of the INVESTOR ITSELF within the source (Wikidata QID, ADV CRD).
   *  Distinct from `externalId` above, which identifies the holding. Used to
   *  resolve the holding to a first-class Investor row. */
  investorExternalId?: string;
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

/**
 * An investor firm as an entity in its own right, with no company edge.
 *
 * Sources like SEC Form ADV publish a firm universe without disclosing any
 * portfolio, so these arrive detached — they become Investor rows that a
 * contributor can later attach companies to.
 */
export interface NormalizedInvestorFirm {
  /** Stable id of the firm within the source (ADV CRD number, Wikidata QID). */
  externalId: string;
  name: string;
  legalName?: string | null;
  type: InvestorType;
  hq?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  /** Match key and logo source. Sources MUST leave this null when the website's
   *  host belongs to a platform (medium.com, crunchbase.com, …) rather than the
   *  firm — see util/domain.ts. */
  domain?: string | null;
  description?: string | null;
  crdNumber?: string | null;
  cikNumber?: string | null;
  /** Number of private funds the firm reports. */
  fundCount?: number | null;
  /** Gross assets across those funds, USD. */
  assetsUsd?: number | null;
  foundedYear?: number | null;
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
  /** Sources that publish an investor universe implement this too. Keeping it on
   *  the same interface means one DI token and one INGEST_SOURCES env var. */
  fetchInvestors?(opts: FetchOptions): Promise<NormalizedInvestorFirm[]>;
}
