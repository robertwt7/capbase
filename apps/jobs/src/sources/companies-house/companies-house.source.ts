import { Injectable, Logger } from '@nestjs/common';

import type { FetchOptions, IngestionSource, NormalizedRecord } from '../ingestion-source';
import { CompaniesHouseClient } from './companies-house.client';
import { COMPANIES_HOUSE, keepReason, toRecord } from './companies-house.parser';

/**
 * Companies House source — the UK register's "past the small-company
 * thresholds" slice.
 *
 * Not the whole register: 5.3M rows, ≈95% of them micro or dormant shells, is
 * the same reasoning that keeps pooled funds out of Company — and it would not
 * fit the worker. The slice is active share-capital companies filing FULL,
 * GROUP or MEDIUM accounts (≈110k), plus every company number we already hold,
 * whatever its size, so a grantee or a Wikidata company is always enriched.
 *
 * Registered after INNOVATE_UK and after WIKIDATA, so both sources' numbers are
 * in `knownCompanyNumbers` by the time this runs.
 */
@Injectable()
export class CompaniesHouseSource implements IngestionSource {
  readonly name = COMPANIES_HOUSE;
  private readonly logger = new Logger(CompaniesHouseSource.name);

  constructor(private readonly client: CompaniesHouseClient) {}

  /** `days` is ignored — a monthly full snapshot. */
  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
    const known = opts.knownCompanyNumbers ?? new Set<string>();
    const out: NormalizedRecord[] = [];
    const kept = { known: 0, slice: 0 };

    const { snapshot, rows } = await this.client.streamRows((row) => {
      if (out.length >= opts.limit) return;
      const reason = keepReason(row, known);
      if (!reason) return;
      kept[reason]++;
      out.push(toRecord(row, reason));
    });

    this.logger.log(
      `Companies House ${snapshot}: ${rows} scanned, kept ${out.length} ` +
        `(${kept.known} already-held numbers of ${known.size}, ${kept.slice} by size)`,
    );
    return out;
  }
}
