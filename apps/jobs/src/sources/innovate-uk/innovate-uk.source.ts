import { Injectable, Logger } from '@nestjs/common';

import { loadFxTable } from '../../util/fx';
import type { FetchOptions, IngestionSource, NormalizedRecord } from '../ingestion-source';
import { InnovateUkClient } from './innovate-uk.client';
import { INNOVATE_UK, InnovateUkAggregator } from './innovate-uk.parser';

/**
 * Innovate UK funded-projects source — the UK analogue of SBIR.
 *
 * Every UK business that took Innovate UK money since 2004, keyed by its
 * Companies House number, with each award as a round in pounds and its USD
 * equivalent at the ECB rate of the project's start date. Grants land as
 * `kind: 'Grant'` (not raised capital, so the market tape skips them); the
 * few Innovation Loans land as `Debt`.
 *
 * Runs before COMPANIES_HOUSE (registration order), so the register sweep sees
 * every grantee's number and enriches it even below its size threshold.
 */
@Injectable()
export class InnovateUkSource implements IngestionSource {
  readonly name = INNOVATE_UK;
  private readonly logger = new Logger(InnovateUkSource.name);

  constructor(private readonly client: InnovateUkClient) {}

  /** `days` is ignored — the dataset is a full snapshot, not a rolling window. */
  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
    const fx = await loadFxTable();
    const aggregator = new InnovateUkAggregator(fx);
    const { files, rows } = await this.client.streamRows((row) => aggregator.add(row));

    const records = aggregator.records();
    const awards = records.reduce((sum, r) => sum + (r.rounds?.length ?? 0), 0);
    const d = aggregator.drops;
    this.logger.log(
      `Innovate UK: ${records.length} companies, ${awards} awards from ${rows} rows in ${files.length} files ` +
        `(dropped: ${d.notACompany} not a company, ${d.noCrn} no CRN, ${d.withdrawn} withdrawn, ` +
        `${d.noAward} no award, ${d.noDate} no date, ${d.noFx} no FX rate)`,
    );
    return records.slice(0, opts.limit);
  }
}
