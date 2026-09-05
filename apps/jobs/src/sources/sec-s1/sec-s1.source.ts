import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { kebab } from '../../util/slug';
import type {
  FetchOptions,
  IngestionSource,
  NormalizedInvestor,
  NormalizedRecord,
} from '../ingestion-source';
import { isEntityName, parseOwnership, type OwnershipRow } from './ownership.parser';
import { S1Client, type S1Ref } from './s1.client';

export const SEC_S1 = 'SEC_S1';

/** EDGAR full-text search starts in 2001; this bounds the walk further. */
const DEFAULT_START_DATE = '2015-01-01';
const DEFAULT_MIN_CONFIDENCE = 0.6;
const PROGRESS_EVERY = 50;

/**
 * SEC Form S-1 principal-stockholder tables.
 *
 * The first automatable investor→company edge set at scale. Form D names the
 * issuer and Form ADV names a firm's funds; neither discloses a portfolio. An
 * S-1's beneficial-ownership section names the firms that own the company, and
 * roughly 1,000 original S-1s are filed a year.
 *
 * It contributes no rounds and no money: an S-1 says who owns the company, not
 * what it raised. And it publishes an edge only against a firm the investor
 * universe already holds — see `onlyIfKnown`.
 */
@Injectable()
export class SecS1Source implements IngestionSource {
  readonly name = SEC_S1;
  private readonly logger = new Logger(SecS1Source.name);
  private readonly startDate: string;
  private readonly minConfidence: number;

  constructor(
    private readonly client: S1Client,
    config: ConfigService,
  ) {
    const start = config.get<string>('S1_START_DATE')?.trim();
    this.startDate = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : DEFAULT_START_DATE;

    const confidence = Number(config.get<string>('S1_MIN_CONFIDENCE'));
    this.minConfidence =
      Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
        ? confidence
        : DEFAULT_MIN_CONFIDENCE;
  }

  /** `days` is ignored — the window is S1_START_DATE to today, and `limit`
   *  caps the number of documents fetched rather than the records returned. */
  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
    const today = new Date().toISOString().slice(0, 10);
    const refs = await this.client.listS1Docs(this.startDate, today);
    if (refs.length === 0) return [];

    const out: NormalizedRecord[] = [];
    const seenCik = new Set<string>();
    let fetched = 0;
    let parsed = 0;

    for (const ref of refs) {
      if (fetched >= opts.limit) break;
      // One record per filer: an issuer's S-1/A restates the same table.
      if (seenCik.has(ref.cik)) continue;
      seenCik.add(ref.cik);

      const html = await this.client.fetchDocument(ref);
      fetched += 1;
      if (fetched % PROGRESS_EVERY === 0) {
        this.logger.log(
          `Fetched ${fetched}/${Math.min(refs.length, opts.limit)} S-1 documents — ` +
            `${parsed} with an ownership table, ${out.length} records`,
        );
      }
      if (!html) continue;

      const rows = parseOwnership(html);
      if (rows.length === 0) continue;
      parsed += 1;

      const record = this.toRecord(ref, rows);
      if (record) out.push(record);
    }

    this.logger.log(
      `Normalized ${out.length} S-1 filers from ${fetched} documents ` +
        `(${parsed} yielded an ownership table)`,
    );
    return out;
  }

  /** One record per filer CIK: the company plus its institutional holders. */
  private toRecord(ref: S1Ref, rows: OwnershipRow[]): NormalizedRecord | null {
    const investors = rows
      .filter((row) => row.confidence >= this.minConfidence)
      // The one structural signal separating a firm from a director in the same
      // table is a legal-form token. The score cannot do this on its own: a
      // director with a parsed percentage in a well-anchored table scores 0.8.
      .filter((row) => isEntityName(row.name))
      .map((row) => toInvestor(ref, row));

    if (investors.length === 0) return null;

    const cik = ref.cik.replace(/^0+/, '') || ref.cik;
    return {
      source: SEC_S1,
      companyExternalId: cik,
      company: {
        name: ref.filer || `SEC filer ${cik}`,
        hq: '',
        foundedYear: 0,
        industry: [],
        primarySector: null,
        stage: 'Late stage',
        status: 'Private',
        // An S-1 discloses ownership, not proceeds. Writing anything here would
        // be inventing a figure the filing does not state.
        totalRaisedUsd: 0,
        oneLiner: 'Filed a Form S-1 registration statement with the SEC.',
        description:
          `${ref.filer || `SEC filer ${cik}`} filed a Form S-1 registration statement with the ` +
          `SEC on ${ref.filedAt}. Its principal-stockholder table names the firms below.`,
        identifiers: [{ scheme: 'CIK', value: cik }],
      },
      investors,
    };
  }
}

function toInvestor(ref: S1Ref, row: OwnershipRow): NormalizedInvestor {
  const cik = ref.cik.replace(/^0+/, '') || ref.cik;
  return {
    externalId: `${cik}:holder:${kebab(row.name)}`,
    name: row.name,
    // A placeholder the resolver overrides with the matched firm's own type,
    // which came from source structure. `onlyIfKnown` guarantees there is one.
    type: 'Venture',
    firstRound: 'Undisclosed',
    rounds: 0,
    onlyIfKnown: true,
  };
}
