import type { Stage } from '@repo/api';

/**
 * A source-agnostic, normalized funding record. Each ingestion source (SEC
 * EDGAR today; Wikidata / OpenCorporates later) maps its raw data into this
 * shape so the IngestService can upsert it uniformly.
 */
export interface NormalizedFiling {
  /** Provenance tag, stored on the row for idempotent upserts (e.g. SEC_EDGAR). */
  source: string;
  /** Stable id of the issuer within the source (e.g. SEC CIK). */
  companyExternalId: string;
  /** Stable id of this specific filing/round within the source (e.g. accession). */
  roundExternalId: string;

  company: {
    name: string;
    hq: string;
    foundedYear: number;
    industry: string[];
    stage: Stage;
    /** Total capital raised to date, in USD. */
    totalRaisedUsd: number;
  };

  round: {
    name: string;
    /** ISO date (YYYY-MM-DD). */
    date: string;
    amountUsd: number;
  };
}

export const INGESTION_SOURCES = Symbol('INGESTION_SOURCES');

/** Contract every ingestion source implements. */
export interface IngestionSource {
  readonly name: string;
  /** Fetch up to `limit` of the most recent normalized filings. */
  fetchRecent(limit: number): Promise<NormalizedFiling[]>;
}
