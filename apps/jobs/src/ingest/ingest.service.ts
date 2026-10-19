import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import {
  normalizeIdentifier,
  normalizePersonName,
  type IdentifiableType,
  type InvestorType,
} from '@repo/api';
import { Prisma, refreshDirectoryCounts, toJsonValue } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import {
  INGESTION_SOURCES,
  type FetchOptions,
  type IngestionSource,
  type NormalizedFund,
  type NormalizedFundCommitment,
  type NormalizedFundMetric,
  type NormalizedInvestor,
  type NormalizedInvestorFirm,
  type NormalizedPerson,
  type NormalizedRecord,
  type NormalizedRound,
  type SourceBatch,
  type SourceFirmRef,
  type SourceFundRef,
  type SourceIdentifier,
} from '../sources/ingestion-source';
import { kebab } from '../util/slug';
import { uniqueFundSlug } from './fund-slug';
import {
  emptyCounts,
  recordCandidate,
  writeIdentifier,
  type IdentifierCounts,
  type IdentifierWriterClient,
} from './identifier.writer';
import { uniquePersonSlug } from './person-matcher';
import { pairNearDuplicates } from './round-dedup';

export interface IngestResult {
  processed: number;
  upserted: number;
  /** Investor firms upserted from sources that publish an investor universe. */
  investors: number;
  /** Private funds written by sources that publish them. */
  funds: number;
}

export interface RunOptions extends FetchOptions {
  /** Restrict the run to these source names (all sources when absent). */
  sources?: string[];
}

/** Preloaded lookup tables for match-&-enrich (one query per run). */
interface MatchIndex {
  /** `${externalSource}:${externalId}` → company id. */
  byKey: Map<string, string>;
  /** `${scheme}:${normalized value}` → company id. The strongest signal: an
   *  identifier is a statement by the publisher about which entity this is. */
  byIdentifier: Map<string, string>;
  /** domain → company id (first wins). */
  byDomain: Map<string, string>;
  /** normalizeName(name) → every company id holding that name, in load order.
   *  A list rather than first-wins, because the first holder may be in another
   *  country: "Acme Ltd" (GB) must be able to skip "Acme Inc" (US). */
  byName: Map<string, string | string[]>;
  /** company id → its countryCode (null when no source has stated one). Kept
   *  beside byName rather than inside it so filling a blank country updates
   *  every name the row is listed under at once. */
  countryOf: Map<string, string | null>;
  /** company id → the Companies House number it holds. A company has exactly
   *  one, so a row already holding a DIFFERENT number is a different legal
   *  entity, however alike the names: Costain Limited 00610201 and 01393773
   *  are two companies, and merging them on a name would be wrong. */
  companyNumberOf: Map<string, string>;
  /** Every slug in use, to mint unique ones without extra queries. */
  slugs: Set<string>;
  /** What this run's identifier writes did, reported once at the end. */
  identifiers: IdentifierCounts;
}

/** Lookup tables for funds (one query per run). */
interface FundIndex {
  /** `${externalSource}:${externalId}` → fund id. */
  byKey: Map<string, string>;
  /**
   * normalizeFundName(name) → every fund holding it, as `${fundId} ${managerId}`
   * (a bare string for the common single holder — an array per name costs tens
   * of MB across the whole table).
   *
   * Two lookups read it (`fundByName`). A Form D fund carries no manager, so for
   * it a name claimed by more than one manager matches NOTHING: 191 of 94,399
   * ADV fund names collide (`fund 5`, `fund b`, `94`). A fund whose source
   * states its manager only needs the name to be unique within that manager —
   * another firm's namesake is irrelevant.
   */
  holders: Map<string, string | string[]>;
  /** Investor.crdNumber → investor id. Keyed on the column, not on
   *  (externalSource, externalId): investors carry a CRD from enrichment
   *  without carrying SEC_ADV provenance — Andreessen Horowitz among them. */
  investorByCrd: Map<string, string>;
  /** Every fund slug in use, to mint unique ones without extra queries. */
  slugs: Set<string>;
}

/** What upsertFund did with one incoming fund. `skipped` means no manager
 *  could be resolved structurally, which is the rule that keeps every
 *  Fund.managerId real. */
type FundOutcome = 'written' | 'skipped';

/** A round already on a company, as the cross-source dedup compares it. */
interface ExistingRound {
  id: string;
  name: string;
  date: Date;
  amountUsd: number;
  kind: string;
  currency: string;
  amountLocal: bigint | null;
  externalSource: string | null;
  /** Columns the partner already corrected on this round. */
  partnerFields: string[];
}

/** The same lookup tables for investor firms. */
interface InvestorIndex {
  /** `${externalSource}:${externalId}` → investor id. */
  byKey: Map<string, string>;
  /** `${scheme}:${normalized value}` → investor id, same contract as MatchIndex. */
  byIdentifier: Map<string, string>;
  /** domain → investor id (first wins). */
  byDomain: Map<string, string>;
  /** normalizeInvestorName(name) → investor id (first wins). */
  byName: Map<string, string>;
  /** investor id → its own InvestorType, which came from source structure and
   *  therefore beats whatever a holding guessed. */
  types: Map<string, InvestorType>;
  /** investor id → display name, for RoundInvestor rows, which carry one. */
  names: Map<string, string>;
  /** Firms that exist only because of the partner (Investor.partnerOnly). A
   *  public source resolving one makes it public record, without a read. */
  partnerOnly: Set<string>;
  slugs: Set<string>;
  identifiers: IdentifierCounts;
}

/** Counters for the edge kinds a streaming source adds, reported once per run.
 *  Every "skipped" count is a row dropped on purpose (an unresolvable endpoint),
 *  never an error. */
interface EdgeStats {
  fundsSkipped: number;
  commitments: number;
  commitmentsSkipped: number;
  metrics: number;
  metricsSkipped: number;
  roundInvestors: number;
  roundInvestorsSkipped: number;
  roundsDeduped: number;
  roundsEnriched: number;
  contacts: number;
}

function emptyEdgeStats(): EdgeStats {
  return {
    fundsSkipped: 0,
    commitments: 0,
    commitmentsSkipped: 0,
    metrics: 0,
    metricsSkipped: 0,
    roundInvestors: 0,
    roundInvestorsSkipped: 0,
    roundsDeduped: 0,
    roundsEnriched: 0,
    contacts: 0,
  };
}

/** What the edge writers (commitments, metrics, fund refs) read. */
interface RunIndexes {
  investor: InvestorIndex;
  fund: FundIndex;
  stats: EdgeStats;
}

/**
 * The four match indexes, each loaded on first use and then shared for the
 * rest of the run. A public source needs them all; a streaming stage needs only
 * some — the partner companies stage never touches the half-million-row person
 * index, and loading it anyway is what exhausted the heap.
 */
interface LazyIndexes {
  company(): Promise<MatchIndex>;
  investor(): Promise<InvestorIndex>;
  person(): Promise<PersonIndex>;
  fund(): Promise<FundIndex>;
  /** Whatever has been loaded so far, for the end-of-run report. */
  loaded: { company?: MatchIndex; investor?: InvestorIndex; person?: PersonIndex };
}

/**
 * The same lookup tables for people.
 *
 * There is deliberately no `byKey`: a person has no provenance pair of their
 * own. The role row carries `(externalSource, externalId)`; the human behind it
 * is identified by a QID or, failing that, by an exactly-equal normalized name.
 */
interface PersonIndex {
  /** `${scheme}:${normalized value}` → person id, same contract as MatchIndex. */
  byIdentifier: Map<string, string>;
  /** normalizeName(name) → person id (first wins). */
  byName: Map<string, string>;
  slugs: Set<string>;
  identifiers: IdentifierCounts;
  /** Normalized names of people removed on request. Held so a suppressed human
   *  is neither matched nor recreated — ingest auto-APPROVES, so without this
   *  the next cron run would undo the removal. */
  suppressed: Set<string>;
  /** Created this run, against attached: the ratio is what says whether the
   *  matching is working at all. */
  created: number;
  attached: number;
}

// The generic copy written on SEC-created rows; a richer source may replace it.
const SEC_ONE_LINER_PREFIX = 'Private securities offering disclosed';
const SEC_DESCRIPTION_MARKER = 'filed a Form D';

/** Rows per page when the match indexes are loaded. */
const INDEX_PAGE = 20_000;

/**
 * Schemes that are a source's OWN record id. Ingest attaches one to whatever
 * row the source matched — by name, possibly — so a later hit on it repeats our
 * earlier decision rather than stating who the entity is. It still resolves the
 * row (that is its job), but it is not evidence strong enough to rewrite
 * another source's data on.
 */
const SOURCE_RECORD_SCHEMES = new Set<string>(['PARTNER']);

/**
 * Sources whose writes are partner provenance. A row one of them creates is
 * `partnerOnly`; a column one of them writes is listed in `partnerFields`; the
 * API read gate hides both from signed-out viewers. Any other source matching a
 * partner-only row makes it public record (`partnerOnly: false`), and any other
 * source overwriting a partner column takes it out of `partnerFields`. A
 * partner re-run never removes a mark: it fails closed.
 */
const PARTNER_SOURCES = new Set<string>(['PARTNER']);

/** The tables that carry `partnerFields`. */
type PartnerTable = 'Company' | 'Investor' | 'Fund' | 'FundingRound';

/** Whether a row's provenance key belongs in this run's `byKey` — a record
 *  source's own keys only matter to that source (the scheme is named for it). */
const wantKey = (externalSource: string, recordSchemes: boolean) =>
  recordSchemes || !SOURCE_RECORD_SCHEMES.has(externalSource);

/** How far a chain of merges is followed. A survivor can itself be merged
 *  later; the cap stops a cycle from spinning. */
const MAX_MERGE_HOPS = 5;

/** Field-level equality for revision diffs. Arrays compare element-wise (i.e.
 *  `industry`); BigInt money columns compare fine with `===`. */
const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  /**
   * Whether a company update writes to the public timeline. On by default; a
   * from-scratch rebuild (`make ingest-all`) creates the entire corpus, and a
   * "history" of that creation is noise rather than signal — turn it off for
   * those (see docs/DATA_REBUILD.md).
   */
  private readonly recordRevisions: boolean;
  /** Edge counters for the current run (runs are serialized by the ingest lock). */
  private stats: EdgeStats = emptyEdgeStats();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INGESTION_SOURCES) private readonly sources: IngestionSource[],
    config: ConfigService,
  ) {
    this.recordRevisions = (config.get<string>('INGEST_RECORD_REVISIONS') ?? 'true') !== 'false';
  }

  /** Run the configured sources and upsert their records. Idempotent: rows are
   *  keyed by (externalSource, externalId), so re-runs update in place. Records
   *  whose company matches an existing row by domain/name enrich it instead of
   *  creating a duplicate. */
  async run(opts: RunOptions): Promise<IngestResult> {
    const active = opts.sources?.length
      ? this.sources.filter((s) => opts.sources!.includes(s.name))
      : this.sources.filter((s) => !s.explicitOnly);
    if (active.length === 0) {
      this.logger.warn(`No ingestion sources match [${(opts.sources ?? []).join(', ')}]`);
      return { processed: 0, upserted: 0, investors: 0, funds: 0 };
    }

    const lazy = this.lazyIndexes(active.some((src) => SOURCE_RECORD_SCHEMES.has(src.name)));
    this.stats = emptyEdgeStats();
    let processed = 0;
    let upserted = 0;
    let investors = 0;
    let funds = 0;

    for (const source of active) {
      this.logger.log(`Ingesting from ${source.name} (days ${opts.days}, limit ${opts.limit})`);
      if (source.stream) {
        const r = await this.runStream(source, opts, lazy);
        processed += r.processed;
        upserted += r.upserted;
        investors += r.investors;
        funds += r.funds;
        continue;
      }
      const index = await lazy.company();
      const investorIndex = await lazy.investor();
      const personIndex = await lazy.person();
      const fundIndex = await lazy.fund();
      // Rebuilt per source from the live index, so a number an earlier source
      // in this run wrote (Wikidata P2622, an Innovate UK grantee) is known to
      // the register source that follows it.
      const records = await source.fetch({
        ...opts,
        knownCompanyNumbers: knownCompanyNumbers(index),
      });
      processed += records.length;
      let done = 0;
      for (const record of records) {
        try {
          await this.upsert(record, index, investorIndex, personIndex);
          upserted += 1;
        } catch (err) {
          const e = err as { code?: string; meta?: unknown; message?: string };
          this.logger.warn(
            `Upsert failed for ${record.companyExternalId}: code=${e.code} meta=${JSON.stringify(e.meta)} ${e.message?.split('\n')[0]}`,
          );
        }
        done += 1;
        if (done % 1000 === 0) {
          this.logger.log(`Upserted ${done}/${records.length} ${source.name} records`);
        }
      }

      // Sources that publish a standalone investor universe (SEC Form ADV,
      // Wikidata's class-enumerated firms) contribute rows with no company edge.
      if (source.fetchInvestors) {
        const firms = await source.fetchInvestors(opts);
        let firmsDone = 0;
        for (const firm of firms) {
          try {
            await this.upsertInvestorFirm(firm, source.name, investorIndex, personIndex);
            investors += 1;
          } catch (err) {
            const e = err as { code?: string; meta?: unknown; message?: string };
            this.logger.warn(
              `Investor upsert failed for ${firm.externalId}: code=${e.code} meta=${JSON.stringify(e.meta)} ${e.message?.split('\n')[0]}`,
            );
          }
          firmsDone += 1;
          if (firmsDone % 1000 === 0) {
            this.logger.log(`Upserted ${firmsDone}/${firms.length} ${source.name} investor firms`);
          }
        }
      }

      // Private funds. Last, so a source that also publishes its own managers
      // has already created them — a fund whose manager cannot be resolved is
      // dropped, never written against a guessed firm.
      if (!source.fetchFunds) continue;
      const fundOpts: FetchOptions = {
        ...opts,
        knownManagerCrds: new Set(fundIndex.investorByCrd.keys()),
      };
      const incoming = await source.fetchFunds(fundOpts);
      let fundsDone = 0;
      let written = 0;
      let unmatched = 0;
      for (const fund of incoming) {
        try {
          if ((await this.upsertFund(fund, source.name, fundIndex, investorIndex)) === 'written') {
            written += 1;
          } else unmatched += 1;
        } catch (err) {
          const e = err as { code?: string; meta?: unknown; message?: string };
          this.logger.warn(
            `Fund upsert failed for ${fund.externalId}: code=${e.code} meta=${JSON.stringify(e.meta)} ${e.message?.split('\n')[0]}`,
          );
        }
        fundsDone += 1;
        if (fundsDone % 1000 === 0) {
          this.logger.log(`Upserted ${fundsDone}/${incoming.length} ${source.name} funds`);
        }
      }
      funds += written;
      if (incoming.length > 0) {
        this.logger.log(
          `${source.name}: ${incoming.length} funds offered → ${written} written, ${unmatched} unmatched (no manager resolved)`,
        );
      }
    }

    const none = emptyCounts();
    const ids = lazy.loaded.company?.identifiers ?? none;
    const inv = lazy.loaded.investor?.identifiers ?? none;
    const per = lazy.loaded.person?.identifiers ?? none;
    this.logger.log(
      `Ingest complete: ${upserted}/${processed} upserted, ${investors} investor firms, ${funds} funds`,
    );
    // Created vs attached is the number that says whether matching is working:
    // a run that creates a person for every role is not deduplicating.
    const people = lazy.loaded.person;
    this.logger.log(
      `People: ${people?.created ?? 0} created, ${people?.attached ?? 0} roles attached to a person we already held`,
    );
    this.logger.log(
      `Identifiers: ${ids.written + inv.written + per.written} written, ` +
        `${ids.unchanged + inv.unchanged + per.unchanged} unchanged, ` +
        `${ids.skipped + inv.skipped + per.skipped} skipped (failed validation), ` +
        `${ids.conflict + inv.conflict + per.conflict} conflicts (merge candidates recorded)`,
    );
    const st = this.stats;
    if (Object.values(st).some((n) => n > 0)) {
      // Counts only — never a value. The contact count in particular is a
      // number of private rows written, nothing more.
      this.logger.log(
        `Edges: ${st.commitments} commitments (${st.commitmentsSkipped} skipped: fund or LP not held), ` +
          `${st.metrics} fund metrics (${st.metricsSkipped} skipped: fund not held), ` +
          `${st.roundInvestors} round investors (${st.roundInvestorsSkipped} skipped: firm not held), ` +
          `${st.roundsDeduped} rounds skipped as duplicates (${st.roundsEnriched} existing rounds corrected), ` +
          `${st.fundsSkipped} funds skipped (no manager resolved), ` +
          `${st.contacts} private contact rows written`,
      );
    }
    await this.refreshCounts();
    return { processed, upserted, investors, funds };
  }

  /**
   * Recompute the /people and /investors sort keys after a run, in full: a run
   * can add, re-approve or re-point roles and holdings anywhere. Never fails the
   * run — the ingested rows are already written, and the next run heals a stale
   * order — so a failure is logged and reported instead.
   */
  private async refreshCounts(): Promise<void> {
    try {
      const { people, investors } = await refreshDirectoryCounts(this.prisma);
      this.logger.log(`Directory counts: ${people} people, ${investors} investors updated`);
    } catch (err) {
      this.logger.error(`Directory count refresh failed: ${String(err)}`);
      Sentry.captureException(err, { tags: { ingest: 'directory-counts' } });
    }
  }

  /**
   * Apply a streaming source's batches in order, releasing each once written.
   *
   * Within a batch the order is fixed — firms, funds, records, commitments,
   * metrics — so a batch may carry an edge and both its endpoints. Each row has
   * its own try/catch, exactly as the array path does: one bad row is logged
   * and skipped, never fatal. `opts.limit` bounds the records (companies)
   * written, across batches.
   */
  /**
   * Memoized index loaders for one run (see LazyIndexes). `recordSchemes`: load
   * the identifiers in SOURCE_RECORD_SCHEMES too — only when a source that owns
   * one (the partner) is in the run. Nothing else ever looks them up, and on
   * the full dataset they are most of the crosswalk (≈770k of ≈1.2M rows).
   */
  private lazyIndexes(recordSchemes: boolean): LazyIndexes {
    const loaded: LazyIndexes['loaded'] = {};
    const once = <T>(load: () => Promise<T>, keep?: (v: T) => void) => {
      let p: Promise<T> | undefined;
      return () =>
        (p ??= load().then((v) => {
          keep?.(v);
          return v;
        }));
    };
    return {
      loaded,
      company: once(() => this.loadMatchIndex(recordSchemes), (v) => (loaded.company = v)),
      investor: once(() => this.loadInvestorIndex(recordSchemes), (v) => (loaded.investor = v)),
      person: once(() => this.loadPersonIndex(recordSchemes), (v) => (loaded.person = v)),
      fund: once(() => this.loadFundIndex(recordSchemes)),
    };
  }

  private async runStream(
    source: IngestionSource,
    opts: RunOptions,
    lazy: LazyIndexes,
  ): Promise<IngestResult> {
    let processed = 0;
    let upserted = 0;
    let investors = 0;
    let funds = 0;
    let batches = 0;

    const fail = (what: string, id: string, err: unknown) => {
      const e = err as { code?: string; meta?: unknown; message?: string };
      this.logger.warn(
        `${what} upsert failed for ${id}: code=${e.code} meta=${JSON.stringify(e.meta)} ${e.message?.split('\n')[0]}`,
      );
    };

    const stats = this.stats;
    for await (const batch of source.stream!(opts) as AsyncIterable<SourceBatch>) {
      batches++;
      // Load only what this batch writes against.
      const has = (xs?: unknown[]) => (xs?.length ?? 0) > 0;
      const needsPeople =
        (batch.investors ?? []).some((f) => has(f.people)) || (batch.records ?? []).some((r) => has(r.people));
      const investor = await lazy.investor();
      const person = needsPeople ? await lazy.person() : undefined;
      const company = has(batch.records) ? await lazy.company() : undefined;
      const fundIndex =
        has(batch.funds) || has(batch.commitments) || has(batch.metrics) ? await lazy.fund() : undefined;
      // Each is loaded above whenever the rows that read it are present.
      const idx = { investor, fund: fundIndex!, stats };
      for (const firm of batch.investors ?? []) {
        try {
          await this.upsertInvestorFirm(firm, source.name, investor, person ?? (await lazy.person()));
          investors++;
        } catch (err) {
          fail('Investor', firm.externalId, err);
        }
      }
      for (const fund of batch.funds ?? []) {
        try {
          if ((await this.upsertFund(fund, source.name, idx.fund, investor)) === 'written') funds++;
          else stats.fundsSkipped++;
        } catch (err) {
          fail('Fund', fund.externalId, err);
        }
      }
      for (const record of batch.records ?? []) {
        if (processed >= opts.limit) break;
        processed++;
        try {
          // `person` is loaded whenever any record in the batch has people.
          await this.upsert(record, company!, investor, person!);
          upserted++;
        } catch (err) {
          fail('Record', record.companyExternalId, err);
        }
      }
      for (const c of batch.commitments ?? []) {
        try {
          await this.upsertCommitment(c, source.name, idx);
        } catch (err) {
          fail('Commitment', c.externalId, err);
        }
      }
      for (const m of batch.metrics ?? []) {
        try {
          await this.upsertMetric(m, source.name, idx);
        } catch (err) {
          fail('Metric', `${m.fund.externalId}@${m.asAt}`, err);
        }
      }
      if (batches % 10 === 0) {
        this.logger.log(
          `${source.name}: ${batches} batches — ${investors} firms, ${funds} funds, ${upserted} records, ` +
            `${idx.stats.commitments} commitments, ${idx.stats.metrics} metrics`,
        );
      }
    }
    this.logger.log(
      `${source.name}: ${batches} batches → ${investors} investor firms, ${funds} funds, ${upserted}/${processed} records`,
    );
    return { processed, upserted, investors, funds };
  }

  /**
   * A firm the source refers to by its own id: provenance key first (a firm it
   * created), then its identifier (a firm it matched to an existing row, which
   * keeps that row's own key). Never by name — an id-keyed edge must not land
   * on a namesake.
   */
  private resolveFirmRef(ref: SourceFirmRef, source: string, index: InvestorIndex): string | undefined {
    const byKey = index.byKey.get(`${source}:${ref.externalId}`);
    if (byKey) return byKey;
    if (!ref.identifier) return undefined;
    const normalized = normalizeIdentifier(ref.identifier.scheme, ref.identifier.value);
    return normalized ? index.byIdentifier.get(`${ref.identifier.scheme}:${normalized}`) : undefined;
  }

  /**
   * A fund the source refers to by its own id: provenance key first; failing
   * that, the same match `upsertFund` made — the normalized name, held by the
   * same (resolved) manager. That second leg is what lets a later run find a
   * fund this source enriched rather than created.
   */
  private resolveFundRef(ref: SourceFundRef, source: string, idx: RunIndexes): string | undefined {
    const byKey = idx.fund.byKey.get(`${source}:${ref.externalId}`);
    if (byKey) return byKey;
    const managerId = this.resolveFirmRef(ref.manager, source, idx.investor);
    const norm = normalizeFundName(ref.name);
    if (!managerId || !norm) return undefined;
    return fundByName(idx.fund, norm, managerId);
  }

  /** One LP commitment. Both endpoints must already be held; an edge with a
   *  missing end is skipped and counted, never minted against a guess. */
  private async upsertCommitment(
    c: NormalizedFundCommitment,
    source: string,
    idx: RunIndexes,
  ): Promise<void> {
    const fundId = this.resolveFundRef(c.fund, source, idx);
    const investorId = this.resolveFirmRef(c.investor, source, idx.investor);
    if (!fundId || !investorId) {
      idx.stats.commitmentsSkipped++;
      return;
    }
    const currency = (c.currency ?? 'USD').toUpperCase();
    const money = {
      currency,
      amountUsd: c.amountUsd != null ? BigInt(Math.round(c.amountUsd)) : null,
      amountLocal:
        currency !== 'USD' && c.amountLocal != null ? BigInt(Math.round(c.amountLocal)) : null,
    };
    await this.prisma.fundCommitment.upsert({
      where: { externalSource_externalId: { externalSource: source, externalId: c.externalId } },
      create: {
        fundId,
        investorId,
        ...money,
        externalSource: source,
        externalId: c.externalId,
        moderationStatus: 'APPROVED',
      },
      update: { fundId, investorId, ...money },
    });
    idx.stats.commitments++;
  }

  /** One point-in-time fund figure, keyed on (fund, as-at date). */
  private async upsertMetric(m: NormalizedFundMetric, source: string, idx: RunIndexes): Promise<void> {
    const fundId = this.resolveFundRef(m.fund, source, idx);
    if (!fundId) {
      idx.stats.metricsSkipped++;
      return;
    }
    const big = (v: number | null | undefined) => (v != null ? BigInt(Math.round(v)) : null);
    const values = {
      dryPowderUsd: big(m.dryPowderUsd),
      aumUsd: big(m.aumUsd),
      unrealizedUsd: big(m.unrealizedUsd),
    };
    const asAt = new Date(m.asAt);
    await this.prisma.fundMetric.upsert({
      where: { fundId_asAt: { fundId, asAt } },
      create: { fundId, asAt, ...values, externalSource: source },
      update: values,
    });
    idx.stats.metrics++;
  }

  /**
   * Page through a whole table in id order, a bounded slice at a time.
   *
   * The match indexes are built from every row of four tables, and since the
   * partner snapshot those are hundreds of thousands of rows each. Materialising
   * any one as a single Prisma array (an object per row, plus the driver's own
   * copy) was what blew the ~550 MB jobs heap; a page is dropped as soon as its
   * keys are in the maps.
   */
  private async eachPage<T extends { id: string }>(
    fetch: (after: string | undefined, take: number) => Promise<T[]>,
    visit: (rows: T[]) => void,
  ): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const rows = await fetch(after, INDEX_PAGE);
      if (rows.length === 0) return;
      visit(rows);
      if (rows.length < INDEX_PAGE) return;
      after = rows[rows.length - 1]!.id;
    }
  }

  /**
   * id → the live row it resolves to, from the (few) merged rows alone.
   *
   * A merged-away row is KEPT, so every match key it owns must point at the
   * survivor — without this the next run's `byKey` lookup would miss the
   * tombstone, create a fresh row and silently undo the merge. `mergedIntoId`
   * is a foreign key, so every chain ends at a row that exists; a chain longer
   * than MAX_MERGE_HOPS (a cycle) resolves to null.
   */
  private async survivorResolver(
    model: 'company' | 'investor' | 'person',
  ): Promise<(id: string) => string | null> {
    const delegate = this.prisma[model] as unknown as {
      findMany(args: unknown): Promise<{ id: string; mergedIntoId: string | null }[]>;
    };
    const merged = new Map<string, string>();
    for (const r of await delegate.findMany({
      where: { mergedIntoId: { not: null } },
      select: { id: true, mergedIntoId: true },
    })) {
      if (r.mergedIntoId) merged.set(r.id, r.mergedIntoId);
    }
    return (id: string) => {
      let cur = id;
      for (let hops = 0; ; hops++) {
        const next = merged.get(cur);
        if (!next) return cur;
        if (hops >= MAX_MERGE_HOPS) return null;
        cur = next;
      }
    };
  }

  private async loadMatchIndex(recordSchemes = true): Promise<MatchIndex> {
    // A merged-away row keeps its (externalSource, externalId), so a re-ingest
    // of the loser has to land on the SURVIVOR. This is the half of the
    // tombstone design that stops the next cron run from undoing a merge — and
    // the reason the row is kept rather than deleted.
    const survivorOf = await this.survivorResolver('company');
    const index: MatchIndex = {
      byKey: new Map(),
      byIdentifier: await this.loadIdentifiers('company', survivorOf, recordSchemes),
      byDomain: new Map(),
      byName: new Map(),
      countryOf: new Map(),
      companyNumberOf: new Map(),
      slugs: new Set(),
      identifiers: emptyCounts(),
    };
    for (const [key, id] of index.byIdentifier) {
      if (key.startsWith(COMPANY_NUMBER_PREFIX)) {
        index.companyNumberOf.set(id, key.slice(COMPANY_NUMBER_PREFIX.length));
      }
    }
    await this.eachPage(
      (after, take) =>
        this.prisma.company.findMany({
          where: after ? { id: { gt: after } } : {},
          orderBy: { id: 'asc' },
          take,
          select: {
            id: true,
            slug: true,
            name: true,
            domain: true,
            countryCode: true,
            externalSource: true,
            externalId: true,
          },
        }),
      (rows) => {
        for (const c of rows) {
          index.slugs.add(c.slug);
          index.countryOf.set(c.id, c.countryCode ?? null);
          const target = survivorOf(c.id);
          // A tombstone whose chain does not end at a live row is skipped
          // entirely: matching onto it would write to a row nobody can see.
          if (!target) continue;
          if (c.externalSource && c.externalId && wantKey(c.externalSource, recordSchemes)) {
            index.byKey.set(`${c.externalSource}:${c.externalId}`, target);
          }
          if (c.domain && !index.byDomain.has(c.domain)) index.byDomain.set(c.domain, target);
          addName(index, normalizeName(c.name), target);
        }
      },
    );
    return index;
  }

  /**
   * The identifier crosswalk for one entity type, paged — the same order of
   * magnitude as the entity load beside it, and it replaces what would
   * otherwise be a lookup per incoming record. A source's own record ids
   * (SOURCE_RECORD_SCHEMES) are left out unless `recordSchemes`.
   */
  private async loadIdentifiers(
    entityType: IdentifiableType,
    survivorOf: (id: string) => string | null,
    recordSchemes: boolean,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await this.eachPage(
      (after, take) =>
        this.prisma.entityIdentifier.findMany({
          where: {
            entityType,
            ...(recordSchemes ? {} : { scheme: { notIn: [...SOURCE_RECORD_SCHEMES] } }),
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take,
          select: { id: true, scheme: true, value: true, entityId: true },
        }),
      (rows) => {
        for (const r of rows) {
          // A merge moves identifiers onto the survivor, so these usually point
          // at a live row already; resolving anyway covers a row merged by some
          // other path and keeps the index consistent with byKey/byDomain/byName.
          const target = survivorOf(r.entityId);
          if (!target) continue;
          map.set(`${r.scheme}:${r.value}`, target);
        }
      },
    );
    return map;
  }

  private async loadInvestorIndex(recordSchemes = true): Promise<InvestorIndex> {
    const survivorOf = await this.survivorResolver('investor');
    const index: InvestorIndex = {
      byKey: new Map(),
      byIdentifier: await this.loadIdentifiers('investor', survivorOf, recordSchemes),
      byDomain: new Map(),
      byName: new Map(),
      types: new Map(),
      names: new Map(),
      partnerOnly: new Set(),
      slugs: new Set(),
      identifiers: emptyCounts(),
    };
    await this.eachPage(
      (after, take) =>
        this.prisma.investor.findMany({
          where: after ? { id: { gt: after } } : {},
          orderBy: { id: 'asc' },
          take,
          select: {
            id: true,
            slug: true,
            name: true,
            type: true,
            domain: true,
            externalSource: true,
            externalId: true,
            partnerOnly: true,
          },
        }),
      (rows) => {
        for (const i of rows) {
          index.slugs.add(i.slug);
          index.types.set(i.id, i.type as InvestorType);
          index.names.set(i.id, i.name);
          if (i.partnerOnly) index.partnerOnly.add(i.id);
          const target = survivorOf(i.id);
          if (!target) continue;
          if (i.externalSource && i.externalId && wantKey(i.externalSource, recordSchemes)) {
            index.byKey.set(`${i.externalSource}:${i.externalId}`, target);
          }
          if (i.domain && !index.byDomain.has(i.domain)) index.byDomain.set(i.domain, target);
          const norm = normalizeInvestorName(i.name);
          if (norm && !index.byName.has(norm)) index.byName.set(norm, target);
        }
      },
    );
    return index;
  }

  /**
   * Every Person, paged, plus the person slice of EntityIdentifier.
   *
   * Like `loadInvestorIndex` it resolves merge tombstones, which is what makes a
   * person merge stick across the next cron run. Unlike the others it also
   * honours `suppressedAt`: a removal request has to survive ingest, and ingest
   * auto-APPROVES, so a suppressed person is neither matched (their roles stay
   * unresolved rather than reviving them) nor recreated under a new row.
   *
   * And it keeps IDENTIFIER-ONLY people (`Person.identifierOnly`, set by a
   * source that resolves people by its own record id alone — a partner's
   * contacts) out of `byName`, so a later name-keyed source (a Form D "John
   * Smith") never attaches to one by name.
   */
  private async loadPersonIndex(recordSchemes = true): Promise<PersonIndex> {
    const survivorOf = await this.survivorResolver('person');
    const byIdentifier = await this.loadIdentifiers('person', survivorOf, recordSchemes);
    const index: PersonIndex = {
      byIdentifier,
      byName: new Map(),
      slugs: new Set(),
      identifiers: emptyCounts(),
      suppressed: new Set(),
      created: 0,
      attached: 0,
    };

    const suppressedIds = new Set<string>();
    await this.eachPage(
      (after, take) =>
        this.prisma.person.findMany({
          where: after ? { id: { gt: after } } : {},
          orderBy: { id: 'asc' },
          take,
          select: { id: true, slug: true, normalizedName: true, suppressedAt: true, identifierOnly: true },
        }),
      (rows) => {
        for (const p of rows) {
          // Reserved even for a tombstone or a suppressed row: a new person must
          // never take a slug whose URL already means someone else.
          index.slugs.add(p.slug);
          if (p.suppressedAt) {
            suppressedIds.add(p.id);
            if (p.normalizedName) index.suppressed.add(p.normalizedName);
            continue;
          }
          const target = survivorOf(p.id);
          if (!target || p.identifierOnly) continue;
          if (p.normalizedName && !index.byName.has(p.normalizedName)) {
            index.byName.set(p.normalizedName, target);
          }
        }
      },
    );

    // A suppressed person's identifiers must not match either — the QID is the
    // strongest key there is, and honouring only the name would leak them back
    // in through Wikidata.
    for (const [key, id] of index.byIdentifier) {
      if (suppressedIds.has(id)) index.byIdentifier.delete(key);
    }

    return index;
  }

  private async loadFundIndex(recordSchemes = true): Promise<FundIndex> {
    const index: FundIndex = {
      byKey: new Map(),
      holders: new Map(),
      investorByCrd: new Map(),
      slugs: new Set(),
    };

    // Keyed on the crdNumber column rather than (externalSource, externalId):
    // a firm created by Wikidata and later enriched by the ADV sweep carries a
    // CRD without carrying SEC_ADV provenance, and its funds still belong to it.
    const investors = await this.prisma.investor.findMany({
      where: { crdNumber: { not: null } },
      select: { id: true, crdNumber: true },
    });
    for (const i of investors) {
      if (i.crdNumber && !index.investorByCrd.has(i.crdNumber)) {
        index.investorByCrd.set(i.crdNumber, i.id);
      }
    }

    await this.eachPage(
      (after, take) =>
        this.prisma.fund.findMany({
          where: after ? { id: { gt: after } } : {},
          orderBy: { id: 'asc' },
          take,
          select: {
            id: true,
            slug: true,
            name: true,
            managerId: true,
            externalSource: true,
            externalId: true,
          },
        }),
      (rows) => {
        for (const f of rows) {
          if (f.slug) index.slugs.add(f.slug);
          if (f.externalSource && f.externalId && wantKey(f.externalSource, recordSchemes)) {
            index.byKey.set(`${f.externalSource}:${f.externalId}`, f.id);
          }
          this.indexFundName(index, f.name, f.id, f.managerId);
        }
      },
    );
    return index;
  }

  /** Record a fund under its normalized name (see FundIndex.holders). */
  private indexFundName(index: FundIndex, name: string, fundId: string, managerId: string): void {
    const norm = normalizeFundName(name);
    if (!norm) return;
    const entry = `${fundId} ${managerId}`;
    const held = index.holders.get(norm);
    if (held === undefined) index.holders.set(norm, entry);
    else if (typeof held === 'string') {
      if (held !== entry) index.holders.set(norm, [held, entry]);
    } else if (!held.includes(entry)) held.push(entry);
  }

  /**
   * Upsert one private fund: update our own provenance-keyed row, enrich a
   * fund the other SEC source already named, or create a new one.
   *
   * Returns 'skipped' when no manager could be resolved. That is the whole
   * point of the branch: Form ADV Schedule D is the only structural route from
   * a fund to its manager, and guessing one from the fund's name mis-attributes
   * (measured: +0.8% coverage, and the first hit was a false positive).
   */
  private async upsertFund(
    fund: NormalizedFund,
    source: string,
    index: FundIndex,
    investorIndex: InvestorIndex,
  ): Promise<FundOutcome> {
    const facts = fundFacts(fund);
    const key = `${source}:${fund.externalId}`;

    const ownId = index.byKey.get(key);
    if (ownId) {
      // Our own row: the source is authoritative for the fields it publishes —
      // but only those. Writing its blanks would erase what the *other* source
      // contributed (an ADV re-run must not wipe a Form D vintage).
      const written = present(facts);
      await this.prisma.fund.update({
        where: { id: ownId },
        data: { name: fund.name, ...written },
      });
      await this.syncPartnerFields('Fund', ownId, source, Object.keys(written));
      await this.refreshFundSize(ownId);
      return 'written';
    }

    // A manager stated structurally: by CRD (Form ADV), or by the source's own
    // id for a source that published the manager itself.
    const declaresManager = !!fund.managerCrd || !!fund.manager;
    const managerId =
      (fund.managerCrd ? index.investorByCrd.get(fund.managerCrd) : undefined) ??
      (fund.manager ? this.resolveFirmRef(fund.manager, source, investorIndex) : undefined);

    const norm = normalizeFundName(fund.name);
    // A fund that knows its own manager may only merge into that manager's
    // row, looked up within that manager. Only Form D funds — which have no
    // manager at all — use the global name index and take its manager on trust.
    const matchId = !norm
      ? undefined
      : declaresManager
        ? managerId
          ? fundByName(index, norm, managerId)
          : undefined
        : fundByName(index, norm);
    if (matchId) {
      await this.enrichFund(matchId, facts, source);
      await this.refreshFundSize(matchId);
      // Deliberately NOT registered under this source's key: an own-key
      // update renames the row, and an enrichment must never rename a fund
      // the other source created. Edges find it again by name + manager.
      return 'written';
    }

    if (!managerId) return 'skipped';

    const created = await this.prisma.fund.create({
      data: {
        managerId,
        slug: uniqueFundSlug(fund.name, fund.externalId, index.slugs),
        name: fund.name,
        ...facts,
        sizeUsd: (facts.grossAssetsUsd as bigint | null) ?? (facts.closedUsd as bigint | null),
        ...createdProvenance(source, Object.keys(present(facts))),
        externalSource: source,
        externalId: fund.externalId,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });

    index.byKey.set(key, created.id);
    this.indexFundName(index, fund.name, created.id, managerId);
    return 'written';
  }

  /** Keep the directory's size sort key equal to the figure the row shows
   *  (gross assets, else capital closed) after an update or an enrichment,
   *  which may have changed either column. */
  private async refreshFundSize(fundId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "Fund" SET "sizeUsd" = COALESCE("grossAssetsUsd", "closedUsd")
       WHERE id = ${fundId} AND "sizeUsd" IS DISTINCT FROM COALESCE("grossAssetsUsd", "closedUsd")`;
  }

  /** Fill blank columns on a fund the other source already named. Never
   *  overwrites — the two SEC sources publish disjoint facts about one fund,
   *  and a name match is not licence to replace a value already recorded. */
  private async enrichFund(fundId: string, facts: Record<string, unknown>, source: string): Promise<void> {
    const row = await this.prisma.fund.findUnique({ where: { id: fundId } });
    if (!row) return;

    const data = fillBlanks(row as unknown as Record<string, unknown>, facts);
    Object.assign(data, provenanceUpdate(row, source, Object.keys(data)));
    if (Object.keys(data).length > 0) {
      await this.prisma.fund.update({ where: { id: fundId }, data });
    }
  }

  private async upsert(
    r: NormalizedRecord,
    index: MatchIndex,
    investorIndex: InvestorIndex,
    personIndex: PersonIndex,
  ): Promise<void> {
    const { id: companyId, matched, own } = await this.upsertCompany(r, index);

    // Only a record that landed on ANOTHER source's company can duplicate that
    // source's rounds; a created or own-key company holds none.
    const held =
      r.roundDedup && matched && r.rounds?.length
        ? await this.companyRounds(companyId, r.source)
        : { others: [], ownKeys: new Set<string>() };
    // A round this source already wrote is updated in place, never re-paired.
    const fresh = (r.rounds ?? []).map((round, i) => ({ round, i })).filter(({ round }) => !held.ownKeys.has(round.externalId));
    const pairs = pairNearDuplicates(
      fresh.map(({ round }) => ({
        date: new Date(round.date),
        amountUsd: round.amountUsd,
        kind: round.kind ?? 'Equity',
      })),
      held.others,
    );
    const dupOf = new Map<number, ExistingRound>();
    fresh.forEach(({ i }, k) => {
      const hit = pairs.get(k);
      if (hit) dupOf.set(i, hit);
    });
    let roundsChanged = false;

    for (const [i, round] of (r.rounds ?? []).entries()) {
      const kind = round.kind ?? 'Equity';
      const date = new Date(round.date);
      const amountUsd = BigInt(Math.round(round.amountUsd));
      const dup = dupOf.get(i);

      let roundId: string | undefined;
      if (dup) {
        // The same raise, already on the ladder from another source: one rung,
        // not two. Its investors still attach, to the rung that exists.
        this.stats.roundsDeduped++;
        roundId = dup.id;
        // Correcting another source's round is only safe when the company
        // match is a statement (identifier) or a strong inference (domain). A
        // name-only match may be a namesake: it still must not duplicate a
        // round, but it never rewrites one.
        if (
          r.roundDedup === 'enrich' &&
          (matched === 'identifier' || matched === 'domain') &&
          (await this.correctRound(dup, round, companyId, r.source))
        ) {
          roundsChanged = true;
        }
      } else {
        const written = await this.prisma.fundingRound.upsert({
          where: {
            externalSource_externalId: { externalSource: r.source, externalId: round.externalId },
          },
          create: {
            companyId,
            name: round.name,
            date,
            amountUsd,
            kind,
            ...roundMoney(round),
            externalSource: r.source,
            externalId: round.externalId,
            moderationStatus: 'APPROVED',
          },
          update: { amountUsd, date, kind, ...roundMoney(round) },
          select: { id: true },
        });
        roundId = written?.id;
        roundsChanged = true;
        // A public source re-writing its own round undoes any correction the
        // partner made to it. A partner round is partner data as a whole
        // (externalSource), so it needs no field marks.
        if (roundId && !PARTNER_SOURCES.has(r.source)) {
          await this.syncPartnerFields('FundingRound', roundId, r.source, ROUND_OWN_KEY_FIELDS);
        }
      }
      if (roundId && round.investors?.length) {
        await this.writeRoundInvestors(roundId, round.investors, r.source, investorIndex);
      }
    }

    // A matched company now carries rounds its own source never reported, so
    // its stored total can be stale. Raise it — never lower it: a total the
    // other source stated may cover rounds nobody itemised.
    if (r.roundDedup === 'enrich' && (matched || own) && (roundsChanged || own)) {
      await this.raiseTotal(companyId, r.source);
    }

    for (const p of r.people ?? []) {
      await this.writePersonRole(p, r.source, personIndex, { companyId });
    }

    for (const i of r.investors ?? []) {
      // Every holding WRITTEN resolves to a first-class Investor row, minting
      // one if the firm is new — the invariant the nullable investorId column
      // relies on. A holding the source will only publish against a known firm
      // (onlyIfKnown), where none matched, is dropped rather than written null.
      const resolved = await this.resolveInvestor(i, r.source, investorIndex);
      if (!resolved) continue;

      // The resolved firm's own type wins: it came from source structure (a
      // Wikidata P31 class or the ADV fund columns), which a holding never has.
      const type = resolved.type ?? i.type;
      await this.prisma.investorHolding.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: i.externalId },
        },
        create: {
          companyId,
          investorId: resolved.id,
          name: i.name,
          type,
          firstRound: i.firstRound,
          rounds: i.rounds,
          externalSource: r.source,
          externalId: i.externalId,
          moderationStatus: 'APPROVED',
        },
        update: {
          investorId: resolved.id,
          type,
          firstRound: i.firstRound,
          rounds: i.rounds,
        },
      });
    }

    for (const a of r.acquisitions ?? []) {
      const amountUsd = a.amountUsd != null ? BigInt(Math.round(a.amountUsd)) : null;
      await this.prisma.acquisitionDeal.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: a.externalId },
        },
        create: {
          companyId,
          target: a.target,
          date: new Date(a.date),
          amountUsd,
          rationale: a.rationale,
          externalSource: r.source,
          externalId: a.externalId,
          moderationStatus: 'APPROVED',
        },
        update: { date: new Date(a.date), amountUsd, rationale: a.rationale },
      });
    }

    for (const x of r.exits ?? []) {
      const valueUsd = x.valueUsd != null ? BigInt(Math.round(x.valueUsd)) : null;
      await this.prisma.exitEvent.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: x.externalId },
        },
        create: {
          companyId,
          type: x.type,
          date: new Date(x.date),
          valueUsd,
          detail: x.detail,
          externalSource: r.source,
          externalId: x.externalId,
          moderationStatus: 'APPROVED',
        },
        update: { type: x.type, date: new Date(x.date), valueUsd, detail: x.detail },
      });
    }
  }

  /** A company's approved rounds, split into other sources' (dedup targets)
   *  and the keys this source already wrote (updated in place, never paired). */
  private async companyRounds(
    companyId: string,
    source: string,
  ): Promise<{ others: ExistingRound[]; ownKeys: Set<string> }> {
    const rows = await this.prisma.fundingRound.findMany({
      where: { companyId, moderationStatus: 'APPROVED' },
      select: {
        id: true,
        name: true,
        date: true,
        amountUsd: true,
        kind: true,
        currency: true,
        amountLocal: true,
        externalSource: true,
        externalId: true,
        partnerFields: true,
      },
    });
    const others: ExistingRound[] = [];
    const ownKeys = new Set<string>();
    for (const r of rows) {
      if (r.externalSource === source) {
        if (r.externalId) ownKeys.add(r.externalId);
        continue;
      }
      others.push({
        id: r.id,
        name: r.name,
        date: r.date,
        amountUsd: Number(r.amountUsd),
        kind: r.kind,
        currency: r.currency,
        amountLocal: r.amountLocal,
        externalSource: r.externalSource,
        partnerFields: r.partnerFields,
      });
    }
    return { others, ownKeys };
  }

  /**
   * Correct an INGESTED round that this source's record duplicates, with the
   * facts this source states better: its stage name (over a placeholder like
   * "Private placement (Form D)"), its date, and an amount the other source
   * left undisclosed. Each change is a Revision on the company timeline.
   *
   * A human contribution is never modified, and a grant is only ever given a
   * missing amount — an award's own name and date are the agency's record.
   * Returns whether anything changed.
   */
  private async correctRound(
    existing: ExistingRound,
    round: NormalizedRound,
    companyId: string,
    source: string,
  ): Promise<boolean> {
    if (!existing.externalSource) return false;

    const data: Record<string, unknown> = {};
    const isGrant = existing.kind === 'Grant';
    if (!isGrant && !round.genericName && round.name && round.name !== existing.name) {
      data.name = round.name;
    }
    const date = new Date(round.date);
    if (!isGrant && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) !== existing.date.toISOString().slice(0, 10)) {
      data.date = date;
    }
    if (existing.amountUsd === 0 && round.amountUsd > 0) {
      data.amountUsd = BigInt(Math.round(round.amountUsd));
      Object.assign(data, roundMoney(round));
    }
    if (Object.keys(data).length === 0) return false;

    const before: Record<string, unknown> = {
      name: existing.name,
      date: existing.date,
      amountUsd: BigInt(Math.round(existing.amountUsd)),
      currency: existing.currency,
      amountLocal: existing.amountLocal,
    };
    // The columns whose value actually moved: the timeline records them, and
    // for the partner they are what it now owns on this round.
    const moved = Object.keys(data).filter((field) => !sameValue(before[field], data[field]));
    const marks = PARTNER_SOURCES.has(source) ? addPartnerFields(existing.partnerFields, moved) : undefined;
    const update = this.prisma.fundingRound.update({
      where: { id: existing.id },
      data: marks ? { ...data, partnerFields: marks } : data,
    });
    const revisions = moved
      .map((field) => ({
        companyId,
        entityType: 'round',
        entityId: existing.id,
        field,
        before: toJsonValue(before[field]),
        after: toJsonValue(data[field]),
        action: 'UPDATE',
        actor: 'INGEST',
        actorSource: source,
      }));
    if (this.recordRevisions && revisions.length > 0) {
      await this.prisma.$transaction([update, this.prisma.revision.createMany({ data: revisions })]);
    } else {
      await update;
    }

    // Keep the in-memory copy current, so a later pairing in this run compares
    // against what is now stored.
    if (data.name) existing.name = data.name as string;
    if (data.date) existing.date = data.date as Date;
    if (data.amountUsd != null) existing.amountUsd = Number(data.amountUsd);
    if (marks) existing.partnerFields = marks;
    this.stats.roundsEnriched++;
    return true;
  }

  /**
   * Replace THIS SOURCE's RoundInvestor rows for the firms it names on a round.
   * Delete-then-create on exactly those firm ids and this source, so a re-run
   * is idempotent, and a row another source or a contributor wrote survives —
   * including one for the same firm: a firm already named on the round by
   * someone else is left to that row, never duplicated or replaced (the
   * partner naming a public investor must not make it partner data).
   */
  private async writeRoundInvestors(
    roundId: string,
    refs: NonNullable<NormalizedRound['investors']>,
    source: string,
    index: InvestorIndex,
  ): Promise<void> {
    const byFirm = new Map<string, boolean>();
    for (const ref of refs) {
      const id = this.resolveFirmRef(ref, source, index);
      if (!id) {
        this.stats.roundInvestorsSkipped++;
        continue;
      }
      byFirm.set(id, (byFirm.get(id) ?? false) || !!ref.lead);
    }
    if (byFirm.size === 0) return;
    const named = [...byFirm.keys()];
    const heldElsewhere = new Set(
      (
        await this.prisma.roundInvestor.findMany({
          where: { roundId, investorId: { in: named } },
          select: { investorId: true, externalSource: true },
        })
      )
        .filter((row) => row.externalSource !== source)
        .map((row) => row.investorId),
    );
    const ids = named.filter((id) => !heldElsewhere.has(id));
    for (const id of ids) await this.claimInvestor(id, source, index);
    await this.prisma.$transaction([
      this.prisma.roundInvestor.deleteMany({
        where: { roundId, investorId: { in: named }, externalSource: source },
      }),
      this.prisma.roundInvestor.createMany({
        data: ids.map((investorId) => ({
          roundId,
          investorId,
          name: index.names.get(investorId) ?? '',
          lead: byFirm.get(investorId) ?? false,
          externalSource: source,
        })),
      }),
    ]);
    this.stats.roundInvestors += ids.length;
  }

  /** Raise a matched company's stored total to the sum of its approved
   *  non-grant rounds when that sum is larger. Never lowers it. */
  private async raiseTotal(companyId: string, source: string): Promise<void> {
    const [agg, row] = await Promise.all([
      this.prisma.fundingRound.aggregate({
        where: { companyId, moderationStatus: 'APPROVED', kind: { not: 'Grant' } },
        _sum: { amountUsd: true },
      }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { totalRaisedUsd: true } }),
    ]);
    const sum = agg._sum.amountUsd ?? 0n;
    if (row && sum > row.totalRaisedUsd) {
      await this.writeCompany(companyId, source, { totalRaisedUsd: sum });
    }
  }

  /**
   * Write one role row, resolved to the human behind it.
   *
   * `owner` carries exactly one of companyId / investorId — a role hangs off a
   * company or off an investor firm, never both.
   */
  private async writePersonRole(
    p: NormalizedPerson,
    source: string,
    index: PersonIndex,
    owner: { companyId: string } | { investorId: string },
  ): Promise<void> {
    const personId = await this.resolvePerson(p, source, index);
    const role = await this.prisma.personRole.upsert({
      where: {
        externalSource_externalId: { externalSource: source, externalId: p.externalId },
      },
      create: {
        ...owner,
        personId,
        name: p.name,
        role: p.role,
        kind: p.kind ?? null,
        since: p.since,
        endYear: p.endYear ?? null,
        title: p.title ?? null,
        linkedinUrl: p.linkedinUrl ?? null,
        externalSource: source,
        externalId: p.externalId,
        moderationStatus: 'APPROVED',
      },
      // personId is refreshed on every run so a merge, a suppression lift or a
      // late-arriving QID reaches rows written before it.
      update: { personId, role: p.role, kind: p.kind ?? null, title: p.title ?? null, endYear: p.endYear ?? null },
      select: { id: true },
    });

    // Private contact details, keyed on the role. Only for a resolved person:
    // a suppressed or nameless role gets none (and suppression deletes any
    // already held). Counted, never logged.
    const contact = p.contact;
    if (personId && role?.id && contact && (contact.email || contact.phone || contact.linkedinUrl)) {
      const values = {
        personId,
        roleId: role.id,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        linkedinUrl: contact.linkedinUrl ?? null,
      };
      await this.prisma.personContact.upsert({
        where: { externalSource_externalId: { externalSource: source, externalId: p.externalId } },
        create: { ...values, externalSource: source, externalId: p.externalId },
        update: values,
      });
      this.stats.contacts++;
    }
  }

  /**
   * Resolve a role to a `Person`, creating one when the human is new.
   *
   * Identifier first, for the same reason `upsertCompany` matches that way: a
   * QID is a statement by the publisher about WHICH human this is, where an
   * exactly-equal normalized name is a much weaker claim. Nothing looser runs
   * here — spelling variants go to the merge queue, never to an automatic
   * merge.
   *
   * Null means the role stays unattached: either the name normalizes to nothing
   * (no identity can be minted from a blank), or the person asked to be
   * removed, in which case recreating them is exactly what must not happen.
   */
  private async resolvePerson(
    p: NormalizedPerson,
    source: string,
    index: PersonIndex,
  ): Promise<string | null> {
    // The person key, not the company one: it lives in @repo/api so ingest and
    // the moderation path can never disagree about a name they both see.
    const norm = normalizePersonName(p.name);
    if (!norm) return null;
    if (index.suppressed.has(norm)) return null;

    // An identifier-only source never name-matches: its per-person id is the
    // only statement about who this is (see NormalizedPerson.identifierOnly).
    const known =
      (await this.matchByIdentifier('person', p.identifiers, index)) ??
      (p.identifierOnly ? undefined : index.byName.get(norm));
    if (known) {
      index.attached++;
      return known;
    }

    const slug = uniquePersonSlug(p.name, index.slugs);
    const created = await this.prisma.person.create({
      data: {
        slug,
        name: p.name,
        normalizedName: norm,
        identifierOnly: !!p.identifierOnly,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });

    // Update the in-memory index so a later record in the same run matches
    // without a re-query — what the byDomain/byName writes already do. Not for
    // an identifier-only person: registering the name would let the next
    // name-keyed source attach a namesake to them.
    if (!p.identifierOnly) index.byName.set(norm, created.id);
    index.created++;
    await this.writePersonIdentifiers(created.id, source, p.identifiers, index);
    return created.id;
  }

  /** A person's identifiers (only WIKIDATA today). A conflict — the QID is
   *  already held by a different person — records a candidate and does not
   *  overwrite, exactly as it does for companies. */
  private async writePersonIdentifiers(
    personId: string,
    source: string,
    identifiers: SourceIdentifier[] | undefined,
    index: PersonIndex,
  ): Promise<void> {
    for (const { scheme, value } of identifiers ?? []) {
      const outcome = await writeIdentifier(this.prisma as unknown as IdentifierWriterClient, {
        scheme,
        value,
        entityType: 'person',
        entityId: personId,
        source,
      });
      index.identifiers[outcome]++;
      if (outcome === 'written') {
        const normalized = normalizeIdentifier(scheme, value);
        if (normalized) index.byIdentifier.set(`${scheme}:${normalized}`, personId);
      }
    }
  }

  /**
   * Resolve a holding's investor to an Investor row, creating a minimal one when
   * the firm is new. Matching order mirrors upsertCompany: provenance key →
   * normalized name. Holdings carry no website, so there is no domain to match on.
   *
   * Returns the matched firm's own `type` when there was one, so a caller can
   * prefer it over the holding's guess. Null means "no firm, and none minted" —
   * either the name was unusable or the source set `onlyIfKnown`.
   */
  private async resolveInvestor(
    i: NormalizedInvestor,
    source: string,
    index: InvestorIndex,
  ): Promise<{ id: string; type: InvestorType | null } | null> {
    const norm = normalizeInvestorName(i.name);
    if (!norm) return null;

    const key = i.investorExternalId ? `${source}:${i.investorExternalId}` : null;
    // A holding that names its firm by identifier is an id-keyed edge: it
    // resolves by key or identifier, never by name.
    const byRef =
      i.investorIdentifier && i.investorExternalId
        ? this.resolveFirmRef(
            { externalId: i.investorExternalId, identifier: i.investorIdentifier },
            source,
            index,
          )
        : undefined;
    const known =
      (key ? index.byKey.get(key) : undefined) ??
      byRef ??
      (i.investorIdentifier ? undefined : index.byName.get(norm));
    if (known) {
      await this.claimInvestor(known, source, index);
      return { id: known, type: index.types.get(known) ?? null };
    }

    // The source publishes this edge only against a firm we already know and
    // have typed from source structure. Minting one here would be inventing an
    // InvestorType out of a name.
    if (i.onlyIfKnown) return null;

    const slug = this.uniqueInvestorSlug(i.name, i.investorExternalId ?? i.externalId, index);
    const created = await this.prisma.investor.create({
      data: {
        slug,
        name: i.name,
        type: i.type,
        ...createdProvenance(source, ['type']),
        externalSource: i.investorExternalId ? source : null,
        externalId: i.investorExternalId ?? null,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });

    if (PARTNER_SOURCES.has(source)) index.partnerOnly.add(created.id);
    if (key) index.byKey.set(key, created.id);
    index.byName.set(norm, created.id);
    index.types.set(created.id, i.type);
    index.names.set(created.id, i.name);
    return { id: created.id, type: i.type };
  }

  /** Upsert a standalone investor firm: update its own provenance-keyed row,
   *  enrich a domain/name match, or create a new row. */
  private async upsertInvestorFirm(
    firm: NormalizedInvestorFirm,
    source: string,
    index: InvestorIndex,
    personIndex: PersonIndex,
  ): Promise<void> {
    // The source decides the domain: it alone knows whether the website's host
    // identifies the firm or belongs to a platform (see util/domain.ts).
    const domain = firm.domain ?? null;
    const facts = {
      legalName: firm.legalName ?? null,
      hq: firm.hq ?? null,
      websiteUrl: firm.websiteUrl ?? null,
      linkedinUrl: firm.linkedinUrl ?? null,
      countryCode: firm.countryCode ?? null,
      domain,
      description: firm.description ?? null,
      crdNumber: firm.crdNumber ?? null,
      cikNumber: firm.cikNumber ?? null,
      fundCount: firm.fundCount ?? null,
      assetsUsd: firm.assetsUsd != null ? BigInt(Math.round(firm.assetsUsd)) : null,
      foundedYear: firm.foundedYear ?? null,
    };

    const key = `${source}:${firm.externalId}`;
    const ownId = index.byKey.get(key);
    if (ownId) {
      // Our own row: the source is authoritative for the facts it publishes.
      await this.prisma.investor.update({
        where: { id: ownId },
        data: { name: firm.name, type: firm.type, ...facts },
      });
      // Every fact column is written (nulls too), so a public source's update
      // replaces all of them; the partner marks only what it actually stated.
      await this.syncPartnerFields(
        'Investor',
        ownId,
        source,
        PARTNER_SOURCES.has(source) ? ['type', ...Object.keys(present(facts))] : ['type', ...Object.keys(facts)],
      );
      await this.writeIdentifiers('investor', ownId, source, firm.identifiers, domain, index);
      await this.writeFirmPeople(firm, source, ownId, personIndex);
      return;
    }

    // Identifier, then domain, then name. A CRD is the filing's own statement
    // of which firm this is; a domain is the strongest inference. ADV contains
    // real false friends ("Sequoia Planning & Investments LLC", a "Benchmark
    // Capital Group Ltd." that is a wealth manager), so a name-only match must
    // never overwrite anything.
    const matchId =
      (await this.matchByIdentifier('investor', firm.identifiers, index)) ??
      (domain ? index.byDomain.get(domain) : undefined) ??
      index.byName.get(normalizeInvestorName(firm.name));
    if (matchId) {
      await this.enrichInvestor(matchId, facts, source, index);
      index.byKey.set(key, matchId);
      await this.writeIdentifiers('investor', matchId, source, firm.identifiers, domain, index);
      await this.writeFirmPeople(firm, source, matchId, personIndex);
      return;
    }

    const slug = this.uniqueInvestorSlug(firm.name, firm.externalId, index);
    const created = await this.prisma.investor.create({
      data: {
        slug,
        name: firm.name,
        type: firm.type,
        ...facts,
        ...createdProvenance(source, ['type', ...Object.keys(present(facts))]),
        externalSource: source,
        externalId: firm.externalId,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });

    if (PARTNER_SOURCES.has(source)) index.partnerOnly.add(created.id);
    index.byKey.set(key, created.id);
    if (domain && !index.byDomain.has(domain)) index.byDomain.set(domain, created.id);
    const norm = normalizeInvestorName(firm.name);
    if (norm && !index.byName.has(norm)) index.byName.set(norm, created.id);
    index.types.set(created.id, firm.type);
    index.names.set(created.id, firm.name);
    await this.writeIdentifiers('investor', created.id, source, firm.identifiers, domain, index);
    await this.writeFirmPeople(firm, source, created.id, personIndex);
  }

  /** The firm's own officers, as role rows carrying `investorId` and no
   *  company — the investor half of the person join. */
  private async writeFirmPeople(
    firm: NormalizedInvestorFirm,
    source: string,
    investorId: string,
    personIndex: PersonIndex,
  ): Promise<void> {
    for (const p of firm.people ?? []) {
      await this.writePersonRole(p, source, personIndex, { investorId });
    }
  }

  /** Fill blank fields on a matched investor. Never touches name, type, or any
   *  value already present — a name match is not strong enough to overwrite. */
  private async enrichInvestor(
    investorId: string,
    facts: Record<string, unknown>,
    source: string,
    index: InvestorIndex,
  ): Promise<void> {
    const row = await this.prisma.investor.findUnique({ where: { id: investorId } });
    if (!row) return;

    const data = fillBlanks(row as unknown as Record<string, unknown>, facts);
    Object.assign(data, provenanceUpdate(row, source, Object.keys(data)));
    if (Object.keys(data).length > 0) {
      await this.prisma.investor.update({ where: { id: investorId }, data });
    }
    if (data.partnerOnly === false) index.partnerOnly.delete(investorId);
  }

  /** A public source just resolved a partner-only firm (a holding, a round
   *  investor): the firm is public record from now on. No read — the index
   *  knows which firms are partner-only. */
  private async claimInvestor(investorId: string, source: string, index: InvestorIndex): Promise<void> {
    if (PARTNER_SOURCES.has(source) || !index.partnerOnly.has(investorId)) return;
    await this.prisma.investor.update({ where: { id: investorId }, data: { partnerOnly: false } });
    index.partnerOnly.delete(investorId);
  }

  /**
   * Keep a row's `partnerFields` in step with a write of `fields` by `source`,
   * for the write paths that never read the row back: the partner adds what it
   * wrote, any other source removes what it overwrote. One statement, guarded
   * so it writes nothing in the common case (a public source, no marks).
   */
  private async syncPartnerFields(
    table: PartnerTable,
    id: string,
    source: string,
    fields: string[],
  ): Promise<void> {
    if (fields.length === 0) return;
    const t = Prisma.raw(`"${table}"`);
    if (PARTNER_SOURCES.has(source)) {
      await this.prisma.$executeRaw`
        UPDATE ${t} SET "partnerFields" = ARRAY(SELECT DISTINCT unnest("partnerFields" || ${fields}::text[]))
         WHERE id = ${id} AND NOT ("partnerFields" @> ${fields}::text[])`;
    } else {
      await this.prisma.$executeRaw`
        UPDATE ${t} SET "partnerFields" = ARRAY(SELECT f FROM unnest("partnerFields") f WHERE f <> ALL(${fields}::text[]))
         WHERE id = ${id} AND "partnerFields" && ${fields}::text[]`;
    }
  }

  private uniqueInvestorSlug(name: string, externalId: string, index: InvestorIndex): string {
    const base = kebab(name) || kebab(externalId);
    let candidate = base;
    if (index.slugs.has(candidate)) candidate = `${base}-${kebab(externalId)}`;
    for (let n = 2; index.slugs.has(candidate); n++) candidate = `${base}-${kebab(externalId)}-${n}`;
    index.slugs.add(candidate);
    return candidate;
  }

  /**
   * Resolve a record's identifiers against the crosswalk.
   *
   * Two identifiers on one record pointing at *different* existing entities is
   * itself a duplicate signal — the publisher says one entity, we hold two — so
   * it records a candidate rather than picking one arbitrarily and silently.
   * The first hit still wins, because refusing to match would create a third
   * row for the same entity.
   */
  private async matchByIdentifier(
    entityType: IdentifiableType,
    identifiers: SourceIdentifier[] | undefined,
    index: { byIdentifier: Map<string, string> },
  ): Promise<string | undefined> {
    if (!identifiers?.length) return undefined;

    let first: string | undefined;
    for (const { scheme, value } of identifiers) {
      const normalized = normalizeIdentifier(scheme, value);
      if (!normalized) continue;
      const hit = index.byIdentifier.get(`${scheme}:${normalized}`);
      if (!hit) continue;
      if (first === undefined) {
        first = hit;
      } else if (hit !== first) {
        await recordCandidate(this.prisma as unknown as IdentifierWriterClient, {
          entityType,
          aId: first,
          bId: hit,
          signal: 'identifier',
          evidence: `${scheme}:${normalized}`,
        });
      }
    }
    return first;
  }

  /**
   * Persist the identifiers a source published for a row, plus the row's
   * domain.
   *
   * DOMAIN is derived here rather than emitted by each source so the
   * platform/social host rules stay in `util/domain.ts` alone. The in-memory
   * index is updated too, so a later record in the same run matches without a
   * re-query — the same thing the `byDomain`/`byName` writes already do.
   */
  private async writeIdentifiers(
    entityType: IdentifiableType,
    entityId: string,
    source: string,
    identifiers: SourceIdentifier[] | undefined,
    domain: string | null | undefined,
    index: {
      byIdentifier: Map<string, string>;
      identifiers: IdentifierCounts;
      companyNumberOf?: Map<string, string>;
    },
  ): Promise<void> {
    const all: SourceIdentifier[] = [
      ...(identifiers ?? []),
      ...(domain ? [{ scheme: 'DOMAIN' as const, value: domain }] : []),
    ];

    for (const { scheme, value } of all) {
      const outcome = await writeIdentifier(this.prisma as unknown as IdentifierWriterClient, {
        scheme,
        value,
        entityType,
        entityId,
        source,
      });
      index.identifiers[outcome]++;
      if (outcome === 'written') {
        const normalized = normalizeIdentifier(scheme, value);
        if (normalized) index.byIdentifier.set(`${scheme}:${normalized}`, entityId);
      }
      // 'conflict' too: the row now claims this number even though another
      // row holds it in the crosswalk, and must not attract a third.
      if (scheme === 'COMPANIES_HOUSE' && index.companyNumberOf && outcome !== 'skipped') {
        const normalized = normalizeIdentifier(scheme, value);
        if (normalized && !index.companyNumberOf.has(entityId)) {
          index.companyNumberOf.set(entityId, normalized);
        }
      }
    }
  }

  /** Resolve the record to a company row: update its own provenance-keyed row,
   *  enrich a domain/name match, or create a new row. Returns the company id. */
  private async upsertCompany(
    r: NormalizedRecord,
    index: MatchIndex,
  ): Promise<{ id: string; matched: 'identifier' | 'domain' | 'name' | 'record' | null; own: boolean }> {
    const key = `${r.source}:${r.companyExternalId}`;
    const c = r.company;

    const ownId = index.byKey.get(key);
    if (ownId) {
      // Our own row: the source is authoritative, but these are published
      // figures, so the timeline records whichever of them actually move.
      await this.writeCompany(ownId, r.source, {
        name: c.name,
        hq: c.hq || 'Undisclosed',
        industry: c.industry,
        stage: c.stage,
        // A source that folds its rounds into other sources' (roundDedup) has
        // its total raised to the company's round sum after the rounds are
        // written (`raiseTotal`), never set from the record: another of its
        // own records may have matched this company and added rounds, and
        // writing the record's figure would undo that on every run.
        ...(r.roundDedup ? {} : { totalRaisedUsd: BigInt(Math.round(c.totalRaisedUsd)) }),
        // Only when stated: a source that has no country must not erase one
        // another source (or the geography backfill) recorded.
        ...(c.countryCode ? { countryCode: c.countryCode } : {}),
      });
      if (c.countryCode) index.countryOf.set(ownId, c.countryCode);
      await this.writeIdentifiers('company', ownId, r.source, c.identifiers, c.domain, index);
      return { id: ownId, matched: null, own: true };
    }

    // Identifier first: a CIK or a QID is a statement by the publisher about
    // which entity this is. A shared domain is a strong inference and a shared
    // name a weak one, so both stay behind it — and the name match alone is
    // scoped by country, since it is the only one that is an inference about a
    // *different* publisher's row rather than a statement about this one.
    const number = recordCompanyNumber(c.identifiers);
    const byDomain = c.domain ? index.byDomain.get(c.domain) : undefined;
    const byIdentifier = await this.matchByIdentifier('company', c.identifiers, index);
    const byDomainAllowed = byDomain && sameEntityAllowed(index, byDomain, number) ? byDomain : undefined;
    const matchId =
      byIdentifier ?? byDomainAllowed ?? matchName(index, normalizeName(c.name), c.countryCode ?? null, number);
    // How strong the match is, for what a source may then do to the row's
    // data: an identifier the record carries in someone else's scheme, or a
    // shared domain, is strong; a hit on the source's own record id ('record')
    // only repeats an earlier match of unknown strength; a name is weak.
    const hitScheme = byIdentifier
      ? c.identifiers?.find((i) => {
          const v = normalizeIdentifier(i.scheme, i.value);
          return v !== null && index.byIdentifier.get(`${i.scheme}:${v}`) === byIdentifier;
        })?.scheme
      : undefined;
    const matchedBy = byIdentifier
      ? hitScheme && SOURCE_RECORD_SCHEMES.has(hitScheme)
        ? 'record'
        : 'identifier'
      : byDomainAllowed
        ? 'domain'
        : 'name';
    if (matchId) {
      await this.enrich(matchId, r);
      if (c.countryCode && !index.countryOf.get(matchId)) index.countryOf.set(matchId, c.countryCode);
      await this.writeIdentifiers('company', matchId, r.source, c.identifiers, c.domain, index);
      return { id: matchId, matched: matchedBy, own: false };
    }

    const slug = this.uniqueSlug(c.name, r.companyExternalId, index);
    const created = await this.prisma.company.create({
      data: {
        slug,
        name: c.name,
        domain: c.domain ?? '',
        websiteUrl: c.websiteUrl ?? null,
        linkedinUrl: c.linkedinUrl ?? null,
        legalName: c.legalName ?? null,
        operatingStatus: c.operatingStatus ?? null,
        companyType: c.companyType ?? null,
        primarySector: c.primarySector ?? null,
        countryCode: c.countryCode ?? null,
        oneLiner: c.oneLiner ?? `${SEC_ONE_LINER_PREFIX} via SEC Form D.`,
        description: c.description ?? `${c.name} ${SEC_DESCRIPTION_MARKER} notice of exempt offering with the SEC.`,
        hq: c.hq || 'Undisclosed',
        founded: c.foundedYear,
        headcount: c.headcount ?? 0,
        industry: c.industry,
        status: c.status ?? 'Private',
        stage: c.stage,
        totalRaisedUsd: BigInt(Math.round(c.totalRaisedUsd)),
        ...createdProvenance(r.source, suppliedCompanyFields(c)),
        externalSource: r.source,
        externalId: r.companyExternalId,
        moderationStatus: 'APPROVED',
      },
    });

    index.byKey.set(key, created.id);
    if (c.domain && !index.byDomain.has(c.domain)) index.byDomain.set(c.domain, created.id);
    index.countryOf.set(created.id, c.countryCode ?? null);
    addName(index, normalizeName(c.name), created.id);
    await this.writeIdentifiers('company', created.id, r.source, c.identifiers, c.domain, index);
    return { id: created.id, matched: null, own: false };
  }

  /** Fill blank fields on a matched row; replace copy only when it is the
   *  generic SEC placeholder. Never touches name, stage, status, raised
   *  totals, or the row's own provenance keys. */
  private async enrich(companyId: string, r: NormalizedRecord): Promise<void> {
    const row = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!row) return;
    const c = r.company;

    const data: Record<string, unknown> = {};
    if (!row.domain && c.domain) data.domain = c.domain;
    if (!row.websiteUrl && c.websiteUrl) data.websiteUrl = c.websiteUrl;
    if (!row.linkedinUrl && c.linkedinUrl) data.linkedinUrl = c.linkedinUrl;
    if (!row.primarySector && c.primarySector) data.primarySector = c.primarySector;
    if (!row.countryCode && c.countryCode) data.countryCode = c.countryCode;
    if (!row.legalName && c.legalName) data.legalName = c.legalName;
    if (!row.operatingStatus && c.operatingStatus) data.operatingStatus = c.operatingStatus;
    if (!row.companyType && c.companyType) data.companyType = c.companyType;
    if (row.founded === 0 && c.foundedYear) data.founded = c.foundedYear;
    if (row.headcount === 0 && c.headcount) data.headcount = c.headcount;
    if (c.oneLiner && row.oneLiner.startsWith(SEC_ONE_LINER_PREFIX)) data.oneLiner = c.oneLiner;
    if (c.description && row.description.includes(SEC_DESCRIPTION_MARKER)) {
      data.description = c.description;
    }

    // `row` is the pre-update state, so writeCompany needs no second read.
    await this.writeCompany(companyId, r.source, data, row as unknown as Record<string, unknown>);
  }

  /**
   * Apply a company update, recording one Revision per field that actually
   * moves. Enrichment and the own-key update are the two paths that mutate
   * already-published data, and until now neither left any trace.
   *
   * The before-state is read inside this call (unless the caller already holds
   * it) rather than taken from the run-start match index, so a company touched
   * twice in one run diffs against the row as it stands.
   */
  private async writeCompany(
    companyId: string,
    source: string,
    data: Record<string, unknown>,
    known?: Record<string, unknown>,
  ): Promise<void> {
    const fields = Object.keys(data);
    if (!known && fields.length === 0) return;
    if (!known && !this.recordRevisions) {
      await this.prisma.company.update({ where: { id: companyId }, data });
      await this.syncPartnerFields('Company', companyId, source, fields);
      return;
    }

    const before =
      known ??
      ((await this.prisma.company.findUnique({ where: { id: companyId } })) as unknown as Record<
        string,
        unknown
      > | null) ??
      {};
    // Provenance columns ride along with the update but never become
    // revisions: they describe the row, they are not facts on its timeline. A
    // match with nothing to fill still matters here — a public source landing
    // on a partner-only row makes it public record.
    const provenance = provenanceUpdate(before, source, fields);
    if (fields.length === 0 && Object.keys(provenance).length === 0) return;
    const update = { where: { id: companyId }, data: { ...data, ...provenance } };
    if (!this.recordRevisions) {
      await this.prisma.company.update(update);
      return;
    }

    const revisions = Object.keys(data)
      .filter((field) => !sameValue(before[field], data[field]))
      .map((field) => ({
        companyId,
        entityType: 'company',
        entityId: companyId,
        field,
        before: toJsonValue(before[field]),
        after: toJsonValue(data[field]),
        action: 'UPDATE',
        actor: 'INGEST',
        actorSource: source,
      }));

    if (revisions.length === 0) {
      await this.prisma.company.update(update);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.company.update(update),
      this.prisma.revision.createMany({ data: revisions }),
    ]);
  }

  private uniqueSlug(name: string, externalId: string, index: MatchIndex): string {
    const base = kebab(name);
    let candidate = base;
    if (index.slugs.has(candidate)) candidate = `${base}-${kebab(externalId)}`;
    for (let n = 2; index.slugs.has(candidate); n++) candidate = `${base}-${kebab(externalId)}-${n}`;
    index.slugs.add(candidate);
    return candidate;
  }
}

/**
 * The fund holding `norm`. With `managerId`: that manager's fund of that name
 * (first wins). Without (a Form D fund, which names no manager): the name's
 * fund only when every holder has the same manager — an ambiguous name must
 * resolve to no fund, because nothing disambiguates it.
 */
function fundByName(index: FundIndex, norm: string, managerId?: string): string | undefined {
  const held = index.holders.get(norm);
  if (held === undefined) return undefined;
  const list = typeof held === 'string' ? [held] : held;
  const parsed = list.map((e) => {
    const sp = e.indexOf(' ');
    return { fundId: e.slice(0, sp), managerId: e.slice(sp + 1) };
  });
  if (managerId) return parsed.find((h) => h.managerId === managerId)?.fundId;
  return parsed.every((h) => h.managerId === parsed[0]!.managerId) ? parsed[0]!.fundId : undefined;
}

/** Add one name → id entry, once. A single holder is stored as a bare string:
 *  most names have one, and an array per name is tens of MB on the full table. */
function addName(index: MatchIndex, norm: string, id: string): void {
  if (!norm) return;
  const held = index.byName.get(norm);
  if (held === undefined) index.byName.set(norm, id);
  else if (typeof held === 'string') {
    if (held !== id) index.byName.set(norm, [held, id]);
  } else if (!held.includes(id)) held.push(id);
}

/**
 * The first row holding this name whose country is compatible with the
 * record's: equal, or unknown on either side. A known-and-different country
 * never matches — a UK "Acme Ltd" is not a US "Acme Inc", and a name is too weak
 * a signal to merge across a border on. Unknown stays permissive because most
 * contributed and S-1 rows have no country, and refusing those would recreate
 * every one of them.
 */
function matchName(
  index: MatchIndex,
  norm: string,
  country: string | null,
  companyNumber: string | null,
): string | undefined {
  if (!norm) return undefined;
  const held = index.byName.get(norm);
  if (held === undefined) return undefined;
  return (typeof held === 'string' ? [held] : held).find(
      (id) =>
        countriesCompatible(country, index.countryOf.get(id) ?? null) &&
        sameEntityAllowed(index, id, companyNumber),
    );
}

const COMPANY_NUMBER_PREFIX = 'COMPANIES_HOUSE:';

/** The record's own Companies House number, normalized, or null. */
function recordCompanyNumber(identifiers: SourceIdentifier[] | undefined): string | null {
  const raw = identifiers?.find((i) => i.scheme === 'COMPANIES_HOUSE')?.value;
  return raw ? normalizeIdentifier('COMPANIES_HOUSE', raw) : null;
}

/** Whether an inferred match (domain or name) may land on `id`: not when the
 *  row already holds a different Companies House number than the record. The
 *  pair is left for the merge detector to propose instead. */
function sameEntityAllowed(index: MatchIndex, id: string, companyNumber: string | null): boolean {
  if (!companyNumber) return true;
  const held = index.companyNumberOf.get(id);
  return !held || held === companyNumber;
}

/** The compatibility rule shared by ingest matching and the merge detector. */
export function countriesCompatible(a: string | null, b: string | null): boolean {
  return !a || !b || a === b;
}

/** Companies House numbers already held, read off the identifier index. */
function knownCompanyNumbers(index: MatchIndex): Set<string> {
  const out = new Set<string>();
  for (const key of index.byIdentifier.keys()) {
    if (key.startsWith(COMPANY_NUMBER_PREFIX)) out.add(key.slice(COMPANY_NUMBER_PREFIX.length));
  }
  return out;
}

/** A round's native-currency columns. USD rows store no local amount: their
 *  amountUsd already IS the published figure. */
function roundMoney(round: NormalizedRound): { currency: string; amountLocal: bigint | null } {
  const currency = round.currency ?? 'USD';
  return {
    currency,
    amountLocal:
      currency !== 'USD' && round.amountLocal != null ? BigInt(Math.round(round.amountLocal)) : null,
  };
}

/** Fold accents before any ASCII-only step: "Société Générale" must key as
 *  "societe generale", not "socit gnrale". */
function foldAccents(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}+/gu, '');
}

const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'llc',
  'llp',
  'ltd',
  'limited',
  'co',
  'company',
  'plc',
  'cic',
  'sa',
  'sas',
  'ag',
  'gmbh',
  'bv',
  'nv',
]);

/** Company-name key for dedupe matching: accents folded, lowercase,
 *  punctuation stripped (so "L.L.C." → "llc"), trailing legal suffixes
 *  dropped, whitespace collapsed. */
export function normalizeName(name: string): string {
  const tokens = foldAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, '')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

const INVESTOR_LEGAL_SUFFIXES = new Set([
  ...LEGAL_SUFFIXES,
  'lp',
  'llp',
  'lllp',
  'gmbh',
  'bv',
  'nv',
  'ab',
  'oy',
  'as',
  'pte',
  'pty',
  'spa',
  'srl',
  'sarl',
  'kk',
]);

/**
 * Investor-name key for dedupe matching. Strips legal-form suffixes ONLY.
 *
 * Business words are meaning-bearing and must survive: "Greylock Partners" and
 * "Greylock Capital Management" are different firms, as are "Sequoia Capital"
 * and "Sequoia Planning & Investments" (both real rows in the SEC ADV data).
 * Stripping 'capital'/'partners'/'management' would silently merge them.
 */
export function normalizeInvestorName(name: string): string {
  // Punctuation becomes a space, not nothing: "A.Capital Ventures" must read as
  // "a capital ventures", not "acapital ventures".
  const raw = foldAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // That split shatters dotted acronyms ("L.L.C." → l, l, c), so glue runs of
  // two or more consecutive single letters back together before stripping.
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; ) {
    let j = i;
    while (j < raw.length && raw[j]!.length === 1) j++;
    if (j - i >= 2) {
      tokens.push(raw.slice(i, j).join(''));
      i = j;
    } else {
      tokens.push(raw[i]!);
      i += 1;
    }
  }

  while (tokens.length > 1 && INVESTOR_LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

/**
 * Fund-name key for matching an ADV Schedule D fund to a Form D filing.
 *
 * The investor rules are the right ones today — strip trailing legal forms
 * only, keep every meaning-bearing word — and they were what produced the
 * measured 35.4% join rate. Kept as its own function so fund-specific rules
 * (series suffixes, vintage numerals) can be added without touching firm
 * matching, where the same change would be wrong.
 */
export const normalizeFundName = normalizeInvestorName;

/** The columns a source publishes about a fund, with money as BigInt. Nulls are
 *  meaningful here: they say "this source does not report that fact". */
function fundFacts(fund: NormalizedFund): Record<string, unknown> {
  return {
    strategy: fund.strategy ?? null,
    vintageYear: fund.vintageYear ?? null,
    targetUsd: fund.targetUsd != null ? BigInt(Math.round(fund.targetUsd)) : null,
    closedUsd: fund.closedUsd != null ? BigInt(Math.round(fund.closedUsd)) : null,
    grossAssetsUsd: fund.grossAssetsUsd != null ? BigInt(Math.round(fund.grossAssetsUsd)) : null,
    hq: fund.hq ?? null,
    secFundId: fund.secFundId ?? null,
    cikNumber: fund.cikNumber ?? null,
    status: fund.status ?? null,
    launchDate: isoDate(fund.launchDate),
    latestCloseDate: isoDate(fund.latestCloseDate),
    finalCloseDate: isoDate(fund.finalCloseDate),
    hardCapUsd: fund.hardCapUsd != null ? BigInt(Math.round(fund.hardCapUsd)) : null,
    managementFeePct: fund.managementFeePct ?? null,
    carriedInterestPct: fund.carriedInterestPct ?? null,
    hurdleRatePct: fund.hurdleRatePct ?? null,
    targetIrrNetMinPct: fund.targetIrrNetMinPct ?? null,
    targetIrrNetMaxPct: fund.targetIrrNetMaxPct ?? null,
    targetIrrGrossMinPct: fund.targetIrrGrossMinPct ?? null,
    targetIrrGrossMaxPct: fund.targetIrrGrossMaxPct ?? null,
    regionFocus: fund.regionFocus ?? null,
  };
}

/** An ISO date string as a Date, or null for absent/unparseable input. */
function isoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Drop the nulls, so an update writes only what the source actually reported. */
function present(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== null && v !== undefined));
}

/** The facts a row is blank on, to fill without overwriting anything. */
function fillBlanks(current: Record<string, unknown>, facts: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(facts)) {
    if (value !== null && value !== undefined && (current[field] === null || current[field] === undefined)) {
      data[field] = value;
    }
  }
  return data;
}

/** The columns a round's own-key upsert rewrites. */
const ROUND_OWN_KEY_FIELDS = ['amountUsd', 'date', 'kind', 'currency', 'amountLocal'];

/** `current` plus `add`, or undefined when that adds nothing. */
export function addPartnerFields(
  current: readonly string[] | null | undefined,
  add: readonly string[],
): string[] | undefined {
  const have = current ?? [];
  const extra = [...new Set(add)].filter((f) => !have.includes(f));
  return extra.length > 0 ? [...have, ...extra] : undefined;
}

/**
 * How a write of `fields` by `source` changes a row's provenance, given the row
 * as read before the write: the partner marks the columns it wrote (never the
 * name, which is the entity's identity rather than a fact); any other source
 * unmarks the columns it overwrote and, by landing on the row at all, makes a
 * partner-only row public record. `{}` when nothing changes.
 */
export function provenanceUpdate(
  row: { partnerFields?: string[] | null; partnerOnly?: boolean | null } | Record<string, unknown>,
  source: string,
  fields: readonly string[],
): { partnerFields?: string[]; partnerOnly?: boolean } {
  const current = (row.partnerFields as string[] | null | undefined) ?? [];
  if (PARTNER_SOURCES.has(source)) {
    const next = addPartnerFields(current, fields.filter((f) => f !== 'name'));
    return next ? { partnerFields: next } : {};
  }
  const out: { partnerFields?: string[]; partnerOnly?: boolean } = {};
  const kept = current.filter((f) => !fields.includes(f));
  if (kept.length !== current.length) out.partnerFields = kept;
  if (row.partnerOnly === true) out.partnerOnly = false;
  return out;
}

/** A created row's provenance: a partner create is partner-only, with every
 *  column it supplied marked. Nothing for any other source. */
function createdProvenance(
  source: string,
  fields: readonly string[],
): { partnerOnly?: true; partnerFields?: string[] } {
  if (!PARTNER_SOURCES.has(source)) return {};
  return { partnerOnly: true, partnerFields: [...new Set(fields.filter((f) => f !== 'name'))] };
}

/** The company columns a record actually states (the create's own defaults —
 *  'Private', 'Undisclosed', 0, the SEC placeholder copy — are not statements). */
function suppliedCompanyFields(c: NormalizedRecord['company']): string[] {
  const stated: Record<string, unknown> = {
    domain: c.domain,
    websiteUrl: c.websiteUrl,
    linkedinUrl: c.linkedinUrl,
    legalName: c.legalName,
    operatingStatus: c.operatingStatus,
    companyType: c.companyType,
    primarySector: c.primarySector,
    countryCode: c.countryCode,
    oneLiner: c.oneLiner,
    description: c.description,
    hq: c.hq,
    founded: c.foundedYear,
    headcount: c.headcount,
    industry: c.industry,
    status: c.status,
    stage: c.stage,
    totalRaisedUsd: c.totalRaisedUsd,
  };
  return Object.entries(stated)
    .filter(([, v]) => v != null && v !== '' && v !== 0 && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k);
}
