import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { loadFxTable, type FxTable } from '../../util/fx';
import type {
  FetchOptions,
  IngestionSource,
  NormalizedFund,
  NormalizedFundCommitment,
  NormalizedInvestorFirm,
  NormalizedRecord,
  SourceBatch,
} from '../ingestion-source';
import { PartnerClient } from './partner.client';
import {
  PARTNER,
  firmType,
  toCommitment,
  toFund,
  toInvestorFirm,
  toMetric,
  toRecord,
  type KeptFirm,
  type PersonRow,
} from './partner.parser';

/** Rows per page and per yielded batch. */
export const PARTNER_BATCH = 2_000;

/** The stages, in the order a full run yields them — each needs the ones
 *  before it (funds need their managers, commitments need funds and LPs). */
export const PARTNER_STAGES = ['firms', 'funds', 'companies', 'commitments', 'metrics'] as const;
export type PartnerStage = (typeof PARTNER_STAGES)[number];

/** `PARTNER_STAGES` env (comma list) → the stages to run. Empty means all;
 *  an unknown name is an error, so a typo cannot silently run nothing. */
export function parseStages(raw: string | undefined): Set<PartnerStage> {
  const names = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return new Set(PARTNER_STAGES);
  for (const n of names) {
    if (!(PARTNER_STAGES as readonly string[]).includes(n)) {
      throw new Error(`Unknown PARTNER_STAGES entry "${n}" (expected ${PARTNER_STAGES.join(', ')})`);
    }
  }
  return new Set(names as PartnerStage[]);
}

/**
 * The partner snapshot: firms (managers and LPs) with their people,
 * funds with their terms, portfolio companies with their deals, LP commitments
 * and fund metrics.
 *
 * A manual snapshot source, like SEC_ADV_FUNDS: never on a cron. It streams
 * (see `IngestionSource.stream`) because the snapshot is far larger than the
 * worker's heap, and it can run one stage at a time (`PARTNER_STAGES`) so a
 * multi-hour load can be split across days and a crash costs one stage. Every
 * stage is idempotent.
 *
 * A stage run before its prerequisite does not fail: the edges whose ends are
 * missing are skipped and counted by IngestService, and a later re-run of the
 * stage picks them up.
 */
@Injectable()
export class PartnerSource implements IngestionSource {
  readonly name = PARTNER;
  /** A licensed snapshot is loaded on purpose, never by `SOURCE=all`. */
  readonly explicitOnly = true;
  private readonly logger = new Logger(PartnerSource.name);
  /** Replaceable in tests: the real one downloads the ECB history. */
  fxLoader: () => Promise<FxTable> = loadFxTable;

  constructor(
    private readonly client: PartnerClient,
    private readonly config: ConfigService,
  ) {}

  /** Never used — `stream` replaces it. */
  fetch(): Promise<NormalizedRecord[]> {
    return Promise.resolve([]);
  }

  async *stream(opts: FetchOptions): AsyncIterable<SourceBatch> {
    if (!(await this.client.stageLoaded())) {
      this.logger.warn('partner stage not loaded — load it with `make partner-stage-load FILE=…`');
      return;
    }
    const stages = parseStages(this.config.get<string>('PARTNER_STAGES'));
    this.logger.log(`Stages: ${PARTNER_STAGES.filter((s) => stages.has(s)).join(', ')}`);

    // The firm universe decides which firms are investors at all; every stage
    // needs it, and it is small (tens of thousands of short rows).
    const firms = await this.client.allFirms();
    const kept = new Map<string, KeptFirm>();
    const dropped = new Map<string, number>();
    for (const f of firms) {
      const type = firmType(f);
      if (type) kept.set(f.firm_id, { name: f.name.trim(), type });
      else {
        const label = (f.role !== 'lp' ? f.manager_firm_type : f.lp_firm_type) ?? '(blank)';
        dropped.set(label, (dropped.get(label) ?? 0) + 1);
      }
    }
    const droppedTotal = [...dropped.values()].reduce((a, b) => a + b, 0);
    this.logger.log(
      `Firms: ${kept.size} investors kept, ${droppedTotal} dropped (not an investor type): ` +
        [...dropped.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([t, n]) => `${t} ${n}`)
          .join(', '),
    );

    const needsFx = stages.has('companies') || stages.has('commitments') || stages.has('metrics');
    const fx = needsFx ? await this.fxLoader() : null;
    const since = new Date().getUTCFullYear();
    const limit = opts.limit;

    if (stages.has('firms')) yield* this.firmBatches(firms.filter((f) => kept.has(f.firm_id)), kept, since, limit);
    if (stages.has('funds')) yield* this.fundBatches(kept, limit);
    if (stages.has('companies')) yield* this.companyBatches(kept, fx!, limit);
    if (stages.has('commitments')) yield* this.commitmentBatches(kept, fx!, limit);
    if (stages.has('metrics')) yield* this.metricBatches(fx!, limit);
  }

  private async *firmBatches(
    firms: Awaited<ReturnType<PartnerClient['allFirms']>>,
    kept: Map<string, KeptFirm>,
    since: number,
    limit: number,
  ): AsyncIterable<SourceBatch> {
    let people = 0;
    const bounded = firms.slice(0, limit);
    for (let i = 0; i < bounded.length; i += PARTNER_BATCH) {
      const page = bounded.slice(i, i + PARTNER_BATCH);
      const byFirm = new Map<string, PersonRow[]>();
      for (const p of await this.client.people(page.map((f) => f.firm_id))) {
        const list = byFirm.get(p.firm_id);
        if (list) list.push(p);
        else byFirm.set(p.firm_id, [p]);
      }
      const investors: NormalizedInvestorFirm[] = page.map((f) =>
        toInvestorFirm(f, kept.get(f.firm_id)!.type, byFirm.get(f.firm_id) ?? [], since),
      );
      people += investors.reduce((n, f) => n + (f.people?.length ?? 0), 0);
      yield { investors };
    }
    this.logger.log(`Firms stage: ${bounded.length} firms, ${people} people offered`);
  }

  private async *fundBatches(kept: Map<string, KeptFirm>, limit: number): AsyncIterable<SourceBatch> {
    let after = '';
    let offered = 0;
    let skipped = 0;
    while (offered + skipped < limit) {
      const rows = await this.client.funds(after, Math.min(PARTNER_BATCH, limit - offered - skipped));
      if (rows.length === 0) break;
      after = rows[rows.length - 1]!.fund_id;
      const funds: NormalizedFund[] = [];
      for (const r of rows) {
        const f = toFund(r, kept);
        if (f) funds.push(f);
        else skipped++;
      }
      offered += funds.length;
      yield { funds };
    }
    this.logger.log(
      `Funds stage: ${offered} funds offered, ${skipped} dropped (never launched, or manager not an investor)`,
    );
  }

  private async *companyBatches(
    kept: Map<string, KeptFirm>,
    fx: FxTable,
    limit: number,
  ): AsyncIterable<SourceBatch> {
    let after = '';
    let offered = 0;
    let skipped = 0;
    let rounds = 0;
    while (offered < limit) {
      const companies = await this.client.companies(after, PARTNER_BATCH);
      if (companies.length === 0) break;
      after = companies[companies.length - 1]!.company_id;

      const deals = await this.client.deals(companies.map((c) => c.company_id));
      const completedIds = deals.filter((d) => d.status === 'Completed').map((d) => d.deal_id);
      const investorsOf = new Map<string, string[]>();
      for (const e of await this.client.dealInvestors(completedIds)) {
        const list = investorsOf.get(e.deal_id);
        if (list) list.push(e.firm_id);
        else investorsOf.set(e.deal_id, [e.firm_id]);
      }
      const dealsOf = new Map<string, typeof deals>();
      for (const d of deals) {
        const list = dealsOf.get(d.company_id);
        if (list) list.push(d);
        else dealsOf.set(d.company_id, [d]);
      }

      const records: NormalizedRecord[] = [];
      for (const c of companies) {
        if (offered + records.length >= limit) break;
        const r = toRecord(c, dealsOf.get(c.company_id) ?? [], investorsOf, kept, fx);
        if (r) {
          records.push(r);
          rounds += r.rounds?.length ?? 0;
        } else skipped++;
      }
      offered += records.length;
      yield { records };
    }
    this.logger.log(
      `Companies stage: ${offered} companies (${rounds} rounds) offered, ${skipped} not imported ` +
        `(abandoned/rejected, or no completed primary-capital deal)`,
    );
  }

  private async *commitmentBatches(
    kept: Map<string, KeptFirm>,
    fx: FxTable,
    limit: number,
  ): AsyncIterable<SourceBatch> {
    let after: [string, string] = ['', ''];
    let offered = 0;
    let skipped = 0;
    while (offered + skipped < limit) {
      const rows = await this.client.commitments(after, Math.min(PARTNER_BATCH, limit - offered - skipped));
      if (rows.length === 0) break;
      const last = rows[rows.length - 1]!;
      after = [last.fund_id, last.firm_id];
      const commitments: NormalizedFundCommitment[] = [];
      for (const r of rows) {
        const c = toCommitment(r, kept, fx);
        if (c) commitments.push(c);
        else skipped++;
      }
      offered += commitments.length;
      yield { commitments };
    }
    this.logger.log(`Commitments stage: ${offered} offered, ${skipped} dropped (LP not an investor type)`);
  }

  private async *metricBatches(fx: FxTable, limit: number): AsyncIterable<SourceBatch> {
    let after: [string, string] = ['', '1900-01-01'];
    let offered = 0;
    while (offered < limit) {
      const rows = await this.client.metrics(after, Math.min(PARTNER_BATCH, limit - offered));
      if (rows.length === 0) break;
      const last = rows[rows.length - 1]!;
      after = [last.fund_id, last.as_at];
      offered += rows.length;
      yield { metrics: rows.map((r) => toMetric(r, fx)) };
    }
    this.logger.log(`Metrics stage: ${offered} offered`);
  }
}
