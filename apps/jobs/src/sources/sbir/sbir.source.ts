import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { FetchOptions, IngestionSource, NormalizedRecord } from '../ingestion-source';
import { SbirClient } from './sbir.client';
import { SBIR, SbirAggregator } from './sbir.parser';

/** Firms with no award since this year are skipped: the file reaches back to
 *  1983, and a company whose last federal award was in the 1990s is not a
 *  company anyone is looking up today. Set to 1983 for the full history. */
const DEFAULT_MIN_YEAR = 2015;

/**
 * SBIR / STTR award source.
 *
 * America's non-dilutive deep-tech funding: every SBIR and STTR award since
 * 1983, republished monthly as one bulk CSV. That is ~15,700 companies in the
 * default window, almost none of which appear in any other source we ingest —
 * they take federal research money rather than venture capital.
 *
 * Every award lands as `kind: 'Grant'` with `totalRaisedUsd: 0`, so $62bn of
 * federal money shows up on the companies' funding ladders without ever
 * entering the market tape's raised total or deal count.
 */
@Injectable()
export class SbirSource implements IngestionSource {
  readonly name = SBIR;
  private readonly logger = new Logger(SbirSource.name);
  private readonly minYear: number;

  constructor(
    private readonly client: SbirClient,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>('SBIR_MIN_YEAR'));
    this.minYear = Number.isInteger(configured) && configured > 1900 ? configured : DEFAULT_MIN_YEAR;
  }

  /** `days` is ignored — this is a monthly full snapshot, not a rolling window. */
  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
    const aggregator = new SbirAggregator(this.minYear);
    // Aggregating inside the stream callback is what keeps this bounded: the
    // 219,503 raw rows never exist at once, only the ~34,000 firm accumulators.
    const snapshot = await this.client.streamAwards((row) => aggregator.add(row));
    if (!snapshot) return [];

    const records = aggregator.records();
    const rounds = records.reduce((sum, r) => sum + (r.rounds?.length ?? 0), 0);
    this.logger.log(
      `SBIR ${snapshot.label}: ${records.length} firms with an award since ${this.minYear} ` +
        `(${rounds} awards) from ${aggregator.size} firms in the file`,
    );

    return records.slice(0, opts.limit);
  }
}
