import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INVESTOR_TYPES, type InvestorType } from '@repo/api';

import type { FetchOptions, IngestionSource, NormalizedInvestorFirm, NormalizedRecord } from '../ingestion-source';
import { AdvClient } from './adv.client';
import { SEC_ADV, mapAdvRows, parseCsv } from './adv.parser';

/** Hedge funds are opt-in: many are public-markets-only and would dilute a
 *  directory aimed at private-company investors. */
const DEFAULT_TYPES: readonly InvestorType[] = ['Venture', 'Private equity'];

/**
 * SEC Form ADV investor-universe source.
 *
 * Every investment adviser registered with (or exempt-reporting to) the SEC
 * publishes its firm name, CRD/CIK, HQ, website and private-fund rollup in a
 * monthly bulk file. That yields ~7,000 VC/PE firms — the only free, official,
 * redistributable investor universe available.
 *
 * It contributes NO company records: Form ADV discloses a firm's funds and
 * service providers, never its portfolio companies. Those edges have to come
 * from Wikidata or contributors.
 */
@Injectable()
export class SecAdvSource implements IngestionSource {
  readonly name = SEC_ADV;
  private readonly logger = new Logger(SecAdvSource.name);
  private readonly types: readonly InvestorType[];

  constructor(
    private readonly client: AdvClient,
    config: ConfigService,
  ) {
    const configured = (config.get<string>('ADV_INVESTOR_TYPES') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t): t is InvestorType => (INVESTOR_TYPES as readonly string[]).includes(t));
    this.types = configured.length > 0 ? configured : DEFAULT_TYPES;
  }

  /** Form ADV has no company-level data — the investor universe arrives via
   *  fetchInvestors below. */
  async fetch(): Promise<NormalizedRecord[]> {
    return [];
  }

  /** `days` is ignored — this is a monthly full snapshot, not a rolling window. */
  async fetchInvestors(opts: FetchOptions): Promise<NormalizedInvestorFirm[]> {
    const snapshot = await this.client.resolveSnapshot();
    if (!snapshot) return [];

    const out: NormalizedInvestorFirm[] = [];
    const seen = new Set<string>();

    // Exempt reporting advisers first: that is where most VC firms sit, so a
    // low `limit` still returns the most relevant slice.
    for (const url of [snapshot.exempt, snapshot.registered]) {
      if (out.length >= opts.limit) break;
      const csv = await this.client.fetchCsv(url);
      if (!csv) continue;

      const rows = parseCsv(csv);
      const firms = mapAdvRows(rows, this.types);
      this.logger.log(`${firms.length} investor firms from ${rows.length} rows in ${url.split('/').pop()}`);

      for (const firm of firms) {
        if (out.length >= opts.limit) break;
        // A firm can appear in both files across a registration change.
        if (seen.has(firm.externalId)) continue;
        seen.add(firm.externalId);
        out.push(firm);
      }
    }

    this.logger.log(
      `ADV snapshot ${snapshot.label}: ${out.length} firms (types: ${this.types.join(', ')})`,
    );
    return out;
  }
}
