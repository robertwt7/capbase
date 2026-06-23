import { Injectable, Logger } from '@nestjs/common';
import type { Stage } from '@repo/api';

import type { IngestionSource, NormalizedFiling } from '../ingestion-source';
import { EdgarClient } from './edgar.client';
import { parseFormD } from './form-d.parser';

export const SEC_EDGAR = 'SEC_EDGAR';

@Injectable()
export class SecEdgarSource implements IngestionSource {
  readonly name = SEC_EDGAR;
  private readonly logger = new Logger(SecEdgarSource.name);

  constructor(private readonly client: EdgarClient) {}

  async fetchRecent(limit: number): Promise<NormalizedFiling[]> {
    const refs = await this.client.listRecentFormD(new Date());
    const out: NormalizedFiling[] = [];

    for (const ref of refs) {
      if (out.length >= limit) break;
      const xml = await this.client.fetchPrimaryDoc(ref);
      if (!xml) continue;

      const parsed = parseFormD(xml);
      if (!parsed) continue;

      const date = safeIsoDate(parsed.dateOfFirstSale, ref.dateFiled);
      const hq = [parsed.city, parsed.state].filter(Boolean).join(', ');

      out.push({
        source: SEC_EDGAR,
        companyExternalId: ref.cik,
        roundExternalId: ref.accession,
        company: {
          name: parsed.entityName,
          hq,
          foundedYear: parsed.yearOfInc,
          industry: parsed.industry ? [parsed.industry] : [],
          stage: stageFromAmount(parsed.amountSoldUsd),
          totalRaisedUsd: parsed.amountSoldUsd,
        },
        round: {
          name: 'Private placement (Form D)',
          date,
          amountUsd: parsed.amountSoldUsd,
        },
      });
    }

    this.logger.log(`Normalized ${out.length} Form D filings`);
    return out;
  }
}

/** First parseable date from the candidates, else today (YYYY-MM-DD). Guards
 *  against filings with no date-of-first-sale and malformed index dates. */
export function safeIsoDate(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    if (c && !Number.isNaN(Date.parse(c))) return new Date(c).toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

/** Rough stage inference from offering size — Form D doesn't disclose round
 *  series, so we band by amount to keep a valid Stage value. */
export function stageFromAmount(amountUsd: number): Stage {
  if (amountUsd < 5_000_000) return 'Seed';
  if (amountUsd < 20_000_000) return 'Series A';
  if (amountUsd < 60_000_000) return 'Series B';
  if (amountUsd < 150_000_000) return 'Series C';
  if (amountUsd < 400_000_000) return 'Series D';
  return 'Late stage';
}
