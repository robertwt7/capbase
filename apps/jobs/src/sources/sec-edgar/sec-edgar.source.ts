import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Stage } from '@repo/api';

import type {
  FetchOptions,
  IngestionSource,
  NormalizedFund,
  NormalizedRecord,
} from '../ingestion-source';
import { kebab } from '../../util/slug';
import { EdgarClient, type FormDRef } from './edgar.client';
import { parseFormD } from './form-d.parser';
import { fundStrategyForFormD } from './fund-strategy';
import { secSector } from './sector-map';

export const SEC_EDGAR = 'SEC_EDGAR';

// The client throttles request *starts* globally; a few in-flight requests
// hide per-request latency so throughput actually reaches the throttle rate.
const FETCH_CONCURRENCY = 4;
const PROGRESS_EVERY = 250;

@Injectable()
export class SecEdgarSource implements IngestionSource {
  readonly name = SEC_EDGAR;
  private readonly logger = new Logger(SecEdgarSource.name);
  /** Keep pooled funds/SPVs out of the COMPANY table — they are the majority of
   *  Form D filers and are not operating companies. They are routed to `Fund`
   *  either way; this flag has never governed that. */
  private readonly skipFunds: boolean;
  /**
   * Funds collected by the last `fetch`, drained by `fetchFunds`.
   *
   * Pooled Form D filings are ~63% of the feed. They are not operating
   * companies, but they ARE fund closes — vintage, target and capital sold —
   * and collecting them here costs nothing: the filing has already been
   * fetched under the SEC rate limit and parsed.
   */
  private funds: NormalizedFund[] = [];

  constructor(
    private readonly client: EdgarClient,
    config: ConfigService,
  ) {
    this.skipFunds = (config.get<string>('INGEST_SKIP_FUNDS') ?? 'true') !== 'false';
  }

  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
    this.funds = [];
    const refs = await this.client.listFormD(opts.days);
    this.logger.log(`Fetching ${refs.length} Form D filings (concurrency ${FETCH_CONCURRENCY})`);
    const out: NormalizedRecord[] = [];
    let skippedFunds = 0;
    let fetched = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < refs.length && out.length < opts.limit) {
        const ref = refs[cursor++]!;
        const xml = await this.client.fetchPrimaryDoc(ref);
        fetched++;
        if (fetched % PROGRESS_EVERY === 0) {
          this.logger.log(
            `Fetched ${fetched}/${refs.length} filings — ${out.length} normalized, ${skippedFunds} funds skipped`,
          );
        }
        if (!xml) continue;

        const parsed = parseFormD(xml);
        if (!parsed) continue;
        if (parsed.isPooledFund) {
          this.funds.push(toFund(ref, parsed));
          if (this.skipFunds) {
            skippedFunds++;
            continue;
          }
        }
        if (out.length >= opts.limit) return;
        out.push(this.toRecord(ref, parsed));
      }
    };
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));

    this.logger.log(
      `Normalized ${out.length} filings (${skippedFunds} pooled funds kept out of Company, ${this.funds.length} routed to Fund)`,
    );
    return out;
  }

  /** Drain the funds `fetch` collected. Re-walking the daily index to find them
   *  again would double the rate-limited SEC traffic for filings already
   *  downloaded and parsed, so this is a drain, not a fetch: a second call
   *  returns nothing. */
  async fetchFunds(): Promise<NormalizedFund[]> {
    const out = this.funds;
    this.funds = [];
    return out;
  }

  private toRecord(ref: FormDRef, parsed: NonNullable<ReturnType<typeof parseFormD>>): NormalizedRecord {
    const date = safeIsoDate(parsed.dateOfFirstSale, ref.dateFiled);
    const hq = [parsed.city, parsed.state].filter(Boolean).join(', ');

    // Amendments update the original filing's round instead of duplicating it.
    const roundExternalId =
      parsed.isAmendment && parsed.previousAccession ? parsed.previousAccession : ref.accession;

    // People are keyed by CIK (not accession) so D/A re-filings update in place.
    const filingYear = Number(ref.dateFiled.slice(0, 4)) || new Date().getUTCFullYear();
    const people = parsed.people.map((p) => ({
      externalId: `${ref.cik}:person:${kebab(p.name)}`,
      name: p.name,
      role: p.role,
      title: p.title,
      since: filingYear,
    }));

    return {
      source: SEC_EDGAR,
      companyExternalId: ref.cik,
      company: {
        name: parsed.entityName,
        hq,
        foundedYear: parsed.yearOfInc,
        industry: parsed.industry ? [parsed.industry] : [],
        primarySector: parsed.industry ? secSector(parsed.industry) : null,
        stage: stageFromAmount(parsed.amountSoldUsd),
        totalRaisedUsd: parsed.amountSoldUsd,
        identifiers: [{ scheme: 'CIK', value: ref.cik }],
      },
      rounds: [
        {
          externalId: roundExternalId,
          name: 'Private placement (Form D)',
          date,
          amountUsd: parsed.amountSoldUsd,
        },
      ],
      people,
    };
  }
}

/**
 * One pooled Form D filing as a fund.
 *
 * Keyed on the fund's own filer CIK, not the accession — the same reasoning as
 * the person keys above: a D/A re-filing then updates the fund in place rather
 * than minting a second one.
 *
 * `managerCrd` is null and always will be. Form D never names the managing
 * firm: a fund's related persons are the GP's individuals ("Managing Member of
 * the GP of the Issuer's GP"), not the firm itself. The manager comes from
 * matching this fund's name to one Form ADV Schedule D already attributed, or
 * the fund is not published at all.
 */
export function toFund(ref: FormDRef, parsed: NonNullable<ReturnType<typeof parseFormD>>): NormalizedFund {
  return {
    externalId: ref.cik,
    name: parsed.entityName,
    managerCrd: null,
    strategy: fundStrategyForFormD(parsed.investmentFundType),
    vintageYear: parsed.yearOfInc || null,
    targetUsd: parsed.totalOfferingUsd,
    closedUsd: parsed.amountSoldUsd || null,
    grossAssetsUsd: null,
    hq: [parsed.city, parsed.state].filter(Boolean).join(', ') || null,
    secFundId: null,
    cikNumber: ref.cik,
  };
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
