import { Injectable, Logger } from '@nestjs/common';

import type {
  FetchOptions,
  IngestionSource,
  NormalizedInvestorFirm,
  NormalizedRecord,
} from '../ingestion-source';
import { WikidataClient } from './wikidata.client';
import { WIKIDATA, mapInvestorFirms, mapWikidata, qidOf, type WikidataBundle } from './wikidata.mapper';
import {
  acquisitionsQuery,
  chunkQids,
  detailsQuery,
  exitsQuery,
  investorFirmsQuery,
  investorsQuery,
  peopleQuery,
  seedQuery,
} from './wikidata.queries';

/**
 * Enrichment source: the ~6.4k companies on Wikidata carrying investor
 * (P1951) statements, with metadata, investors, founders/CEOs, acquisitions
 * and exits. Has no time axis — `opts.days` is ignored; the set changes
 * slowly, so it is meant for manual/occasional runs, not the daily cron.
 */
@Injectable()
export class WikidataSource implements IngestionSource {
  readonly name = WIKIDATA;
  private readonly logger = new Logger(WikidataSource.name);

  constructor(private readonly client: WikidataClient) {}

  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
    const seed = await this.client.runQuery(seedQuery());
    const qids: string[] = [];
    const seen = new Set<string>();
    for (const b of seed) {
      const qid = qidOf(b.company);
      if (qid && !seen.has(qid)) {
        seen.add(qid);
        qids.push(qid);
      }
      if (qids.length >= opts.limit) break;
    }
    this.logger.log(`Seed query returned ${qids.length} companies with investor statements`);

    const bundle: WikidataBundle = {
      details: [],
      investors: [],
      people: [],
      acquisitions: [],
      exits: [],
    };
    const chunks = chunkQids(qids);
    for (const [i, chunk] of chunks.entries()) {
      bundle.details.push(...(await this.client.runQuery(detailsQuery(chunk))));
      bundle.investors.push(...(await this.client.runQuery(investorsQuery(chunk))));
      bundle.people.push(...(await this.client.runQuery(peopleQuery(chunk))));
      bundle.acquisitions.push(...(await this.client.runQuery(acquisitionsQuery(chunk))));
      bundle.exits.push(...(await this.client.runQuery(exitsQuery(chunk))));
      this.logger.log(`Fetched detail batch ${i + 1}/${chunks.length}`);
    }

    const records = mapWikidata(bundle).slice(0, opts.limit);
    this.logger.log(`Normalized ${records.length} Wikidata companies`);
    return records;
  }

  /** The ~640 entities that ARE investor firms by P31 class, independent of
   *  whether Wikidata records a P1951 edge for them. */
  async fetchInvestors(opts: FetchOptions): Promise<NormalizedInvestorFirm[]> {
    const rows = await this.client.runQuery(investorFirmsQuery());
    const firms = mapInvestorFirms(rows).slice(0, opts.limit);
    this.logger.log(`Normalized ${firms.length} Wikidata investor firms`);
    return firms;
  }
}
