import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeIdentifier, type IdentifiableType, type InvestorType } from '@repo/api';
import { toJsonValue } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import {
  INGESTION_SOURCES,
  type FetchOptions,
  type IngestionSource,
  type NormalizedFund,
  type NormalizedInvestor,
  type NormalizedInvestorFirm,
  type NormalizedRecord,
  type SourceIdentifier,
} from '../sources/ingestion-source';
import { kebab } from '../util/slug';
import {
  emptyCounts,
  recordCandidate,
  writeIdentifier,
  type IdentifierCounts,
  type IdentifierWriterClient,
} from './identifier.writer';

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
  /** normalizeName(name) → company id (first wins). */
  byName: Map<string, string>;
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
   * normalizeFundName(name) → fund id. Names claimed by more than one manager
   * are REMOVED rather than first-wins: 191 of 94,399 ADV fund names collide
   * (`fund 5`, `fund b`, `94`), and a Form D filing carries no manager to
   * disambiguate with, so an ambiguous name must match nothing.
   */
  byName: Map<string, string>;
  /** normalizeFundName(name) → manager id, used to detect the collisions above. */
  managerByName: Map<string, string>;
  /** Investor.crdNumber → investor id. Keyed on the column, not on
   *  (externalSource, externalId): investors carry a CRD from enrichment
   *  without carrying SEC_ADV provenance — Andreessen Horowitz among them. */
  investorByCrd: Map<string, string>;
}

/** What upsertFund did with one incoming fund. `skipped` means no manager
 *  could be resolved structurally, which is the rule that keeps every
 *  Fund.managerId real. */
type FundOutcome = 'written' | 'skipped';

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
  slugs: Set<string>;
  identifiers: IdentifierCounts;
}

// The generic copy written on SEC-created rows; a richer source may replace it.
const SEC_ONE_LINER_PREFIX = 'Private securities offering disclosed';
const SEC_DESCRIPTION_MARKER = 'filed a Form D';

/** How far a chain of merges is followed. A survivor can itself be merged
 *  later; the cap stops a cycle from spinning. */
const MAX_MERGE_HOPS = 5;

/**
 * id → the live row it resolves to, or null when the chain does not end at one.
 *
 * A merged-away row is KEPT, so every match key it owns — its provenance pair,
 * its domain, its name — must now point at the survivor. Without this, the next
 * ingest run's `byKey` lookup would miss the tombstone, create a fresh row, and
 * silently undo the merge.
 */
function resolveTombstones<T extends { id: string; mergedIntoId: string | null }>(
  rows: T[],
): Map<string, string | null> {
  // `?? null` so a row present in the set always resolves; `undefined` from a
  // lookup then means only one thing — a chain pointing outside the set.
  const mergedInto = new Map<string, string | null>();
  for (const r of rows) mergedInto.set(r.id, r.mergedIntoId ?? null);

  const out = new Map<string, string | null>();
  for (const r of rows) {
    let id: string = r.id;
    let hops = 0;
    for (;;) {
      const next = mergedInto.get(id);
      if (next === undefined) {
        // Points at a row this query did not return: unresolvable.
        id = '';
        break;
      }
      if (next === null) break;
      if (++hops > MAX_MERGE_HOPS) {
        id = '';
        break;
      }
      id = next;
    }
    out.set(r.id, id || null);
  }
  return out;
}

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
      : this.sources;
    if (active.length === 0) {
      this.logger.warn(`No ingestion sources match [${(opts.sources ?? []).join(', ')}]`);
      return { processed: 0, upserted: 0, investors: 0, funds: 0 };
    }

    const index = await this.loadMatchIndex();
    const investorIndex = await this.loadInvestorIndex();
    const fundIndex = await this.loadFundIndex();
    let processed = 0;
    let upserted = 0;
    let investors = 0;
    let funds = 0;

    for (const source of active) {
      this.logger.log(`Ingesting from ${source.name} (days ${opts.days}, limit ${opts.limit})`);
      const records = await source.fetch(opts);
      processed += records.length;
      let done = 0;
      for (const record of records) {
        try {
          await this.upsert(record, index, investorIndex);
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
            await this.upsertInvestorFirm(firm, source.name, investorIndex);
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
          if ((await this.upsertFund(fund, source.name, fundIndex)) === 'written') written += 1;
          else unmatched += 1;
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

    const ids = index.identifiers;
    const inv = investorIndex.identifiers;
    this.logger.log(
      `Ingest complete: ${upserted}/${processed} upserted, ${investors} investor firms, ${funds} funds`,
    );
    this.logger.log(
      `Identifiers: ${ids.written + inv.written} written, ` +
        `${ids.unchanged + inv.unchanged} unchanged, ` +
        `${ids.skipped + inv.skipped} skipped (failed validation), ` +
        `${ids.conflict + inv.conflict} conflicts (merge candidates recorded)`,
    );
    return { processed, upserted, investors, funds };
  }

  private async loadMatchIndex(): Promise<MatchIndex> {
    const existing = await this.prisma.company.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        domain: true,
        externalSource: true,
        externalId: true,
        mergedIntoId: true,
      },
    });
    // A merged-away row keeps its (externalSource, externalId), so a re-ingest
    // of the loser has to land on the SURVIVOR. This is the half of the
    // tombstone design that stops the next cron run from undoing a merge — and
    // the reason the row is kept rather than deleted.
    const survivorOf = resolveTombstones(existing);
    const index: MatchIndex = {
      byKey: new Map(),
      byIdentifier: await this.loadIdentifiers('company', survivorOf),
      byDomain: new Map(),
      byName: new Map(),
      slugs: new Set(),
      identifiers: emptyCounts(),
    };
    for (const c of existing) {
      index.slugs.add(c.slug);
      const target = survivorOf.get(c.id);
      // A tombstone whose chain does not end at a live row is skipped entirely:
      // matching onto it would write to a row nobody can see.
      if (!target) continue;
      if (c.externalSource && c.externalId) {
        index.byKey.set(`${c.externalSource}:${c.externalId}`, target);
      }
      if (c.domain && !index.byDomain.has(c.domain)) index.byDomain.set(c.domain, target);
      const norm = normalizeName(c.name);
      if (norm && !index.byName.has(norm)) index.byName.set(norm, target);
    }
    return index;
  }

  /** One query per run over EntityIdentifier for one entity type — the same
   *  order of magnitude as the Company load beside it, and it replaces what
   *  would otherwise be a lookup per incoming record. */
  private async loadIdentifiers(
    entityType: IdentifiableType,
    survivorOf: Map<string, string | null>,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.entityIdentifier.findMany({
      where: { entityType },
      select: { scheme: true, value: true, entityId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      // A merge moves identifiers onto the survivor, so these usually point at
      // a live row already; resolving anyway covers a row merged by some other
      // path and keeps the index consistent with byKey/byDomain/byName.
      const target = survivorOf.get(r.entityId) ?? r.entityId;
      if (target) map.set(`${r.scheme}:${r.value}`, target);
    }
    return map;
  }

  private async loadInvestorIndex(): Promise<InvestorIndex> {
    const existing = await this.prisma.investor.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        type: true,
        domain: true,
        externalSource: true,
        externalId: true,
        mergedIntoId: true,
      },
    });
    const survivorOf = resolveTombstones(existing);
    const index: InvestorIndex = {
      byKey: new Map(),
      byIdentifier: await this.loadIdentifiers('investor', survivorOf),
      byDomain: new Map(),
      byName: new Map(),
      types: new Map(),
      slugs: new Set(),
      identifiers: emptyCounts(),
    };
    for (const i of existing) {
      index.slugs.add(i.slug);
      index.types.set(i.id, i.type as InvestorType);
      const target = survivorOf.get(i.id);
      if (!target) continue;
      if (i.externalSource && i.externalId) {
        index.byKey.set(`${i.externalSource}:${i.externalId}`, target);
      }
      if (i.domain && !index.byDomain.has(i.domain)) index.byDomain.set(i.domain, target);
      const norm = normalizeInvestorName(i.name);
      if (norm && !index.byName.has(norm)) index.byName.set(norm, target);
    }
    return index;
  }

  private async loadFundIndex(): Promise<FundIndex> {
    const index: FundIndex = {
      byKey: new Map(),
      byName: new Map(),
      managerByName: new Map(),
      investorByCrd: new Map(),
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

    const existing = await this.prisma.fund.findMany({
      select: { id: true, name: true, managerId: true, externalSource: true, externalId: true },
    });
    for (const f of existing) {
      if (f.externalSource && f.externalId) {
        index.byKey.set(`${f.externalSource}:${f.externalId}`, f.id);
      }
      this.indexFundName(index, f.name, f.id, f.managerId);
    }
    return index;
  }

  /** Record a fund under its normalized name, dropping the entry entirely once
   *  a second manager claims the same name — an ambiguous name must resolve to
   *  no fund, because a Form D filing carries nothing to disambiguate with. */
  private indexFundName(index: FundIndex, name: string, fundId: string, managerId: string): void {
    const norm = normalizeFundName(name);
    if (!norm) return;
    const heldBy = index.managerByName.get(norm);
    if (heldBy === undefined) {
      index.managerByName.set(norm, managerId);
      index.byName.set(norm, fundId);
    } else if (heldBy !== managerId) {
      index.byName.delete(norm);
    }
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
  ): Promise<FundOutcome> {
    const facts = fundFacts(fund);
    const key = `${source}:${fund.externalId}`;

    const ownId = index.byKey.get(key);
    if (ownId) {
      // Our own row: the source is authoritative for the fields it publishes —
      // but only those. Writing its blanks would erase what the *other* source
      // contributed (an ADV re-run must not wipe a Form D vintage).
      await this.prisma.fund.update({
        where: { id: ownId },
        data: { name: fund.name, ...present(facts) },
      });
      return 'written';
    }

    const norm = normalizeFundName(fund.name);
    const crdManagerId = fund.managerCrd ? index.investorByCrd.get(fund.managerCrd) : undefined;
    const matchId = norm ? index.byName.get(norm) : undefined;
    if (norm && matchId) {
      // A fund that knows its own manager may only merge into that manager's
      // row. Only Form D funds — which have no manager at all — take a name
      // match's manager on trust.
      const matchedManagerId = index.managerByName.get(norm);
      const sameManager = !fund.managerCrd || (!!crdManagerId && crdManagerId === matchedManagerId);
      if (sameManager) {
        await this.enrichFund(matchId, facts);
        return 'written';
      }
    }

    if (!crdManagerId) return 'skipped';

    const created = await this.prisma.fund.create({
      data: {
        managerId: crdManagerId,
        name: fund.name,
        ...facts,
        externalSource: source,
        externalId: fund.externalId,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });

    index.byKey.set(key, created.id);
    this.indexFundName(index, fund.name, created.id, crdManagerId);
    return 'written';
  }

  /** Fill blank columns on a fund the other source already named. Never
   *  overwrites — the two SEC sources publish disjoint facts about one fund,
   *  and a name match is not licence to replace a value already recorded. */
  private async enrichFund(fundId: string, facts: Record<string, unknown>): Promise<void> {
    const row = await this.prisma.fund.findUnique({ where: { id: fundId } });
    if (!row) return;

    const current = row as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(facts)) {
      if (value !== null && value !== undefined && (current[field] === null || current[field] === undefined)) {
        data[field] = value;
      }
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.fund.update({ where: { id: fundId }, data });
    }
  }

  private async upsert(
    r: NormalizedRecord,
    index: MatchIndex,
    investorIndex: InvestorIndex,
  ): Promise<void> {
    const companyId = await this.upsertCompany(r, index);

    for (const round of r.rounds ?? []) {
      await this.prisma.fundingRound.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: round.externalId },
        },
        create: {
          companyId,
          name: round.name,
          date: new Date(round.date),
          amountUsd: BigInt(Math.round(round.amountUsd)),
          kind: round.kind ?? 'Equity',
          externalSource: r.source,
          externalId: round.externalId,
          moderationStatus: 'APPROVED',
        },
        update: {
          amountUsd: BigInt(Math.round(round.amountUsd)),
          date: new Date(round.date),
          kind: round.kind ?? 'Equity',
        },
      });
    }

    for (const p of r.people ?? []) {
      await this.prisma.person.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: p.externalId },
        },
        create: {
          companyId,
          name: p.name,
          role: p.role,
          since: p.since,
          title: p.title ?? null,
          linkedinUrl: p.linkedinUrl ?? null,
          externalSource: r.source,
          externalId: p.externalId,
          moderationStatus: 'APPROVED',
        },
        update: { role: p.role, title: p.title ?? null },
      });
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
    const known = (key ? index.byKey.get(key) : undefined) ?? index.byName.get(norm);
    if (known) return { id: known, type: index.types.get(known) ?? null };

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
        externalSource: i.investorExternalId ? source : null,
        externalId: i.investorExternalId ?? null,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });

    if (key) index.byKey.set(key, created.id);
    index.byName.set(norm, created.id);
    index.types.set(created.id, i.type);
    return { id: created.id, type: i.type };
  }

  /** Upsert a standalone investor firm: update its own provenance-keyed row,
   *  enrich a domain/name match, or create a new row. */
  private async upsertInvestorFirm(
    firm: NormalizedInvestorFirm,
    source: string,
    index: InvestorIndex,
  ): Promise<void> {
    // The source decides the domain: it alone knows whether the website's host
    // identifies the firm or belongs to a platform (see util/domain.ts).
    const domain = firm.domain ?? null;
    const facts = {
      legalName: firm.legalName ?? null,
      hq: firm.hq ?? null,
      websiteUrl: firm.websiteUrl ?? null,
      linkedinUrl: firm.linkedinUrl ?? null,
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
      await this.writeIdentifiers('investor', ownId, source, firm.identifiers, domain, index);
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
      await this.enrichInvestor(matchId, facts);
      index.byKey.set(key, matchId);
      await this.writeIdentifiers('investor', matchId, source, firm.identifiers, domain, index);
      return;
    }

    const slug = this.uniqueInvestorSlug(firm.name, firm.externalId, index);
    const created = await this.prisma.investor.create({
      data: {
        slug,
        name: firm.name,
        type: firm.type,
        ...facts,
        externalSource: source,
        externalId: firm.externalId,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });

    index.byKey.set(key, created.id);
    if (domain && !index.byDomain.has(domain)) index.byDomain.set(domain, created.id);
    const norm = normalizeInvestorName(firm.name);
    if (norm && !index.byName.has(norm)) index.byName.set(norm, created.id);
    index.types.set(created.id, firm.type);
    await this.writeIdentifiers('investor', created.id, source, firm.identifiers, domain, index);
  }

  /** Fill blank fields on a matched investor. Never touches name, type, or any
   *  value already present — a name match is not strong enough to overwrite. */
  private async enrichInvestor(
    investorId: string,
    facts: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.prisma.investor.findUnique({ where: { id: investorId } });
    if (!row) return;

    const current = row as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(facts)) {
      if (value !== null && value !== undefined && (current[field] === null || current[field] === undefined)) {
        data[field] = value;
      }
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.investor.update({ where: { id: investorId }, data });
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
    index: { byIdentifier: Map<string, string>; identifiers: IdentifierCounts },
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
    }
  }

  /** Resolve the record to a company row: update its own provenance-keyed row,
   *  enrich a domain/name match, or create a new row. Returns the company id. */
  private async upsertCompany(r: NormalizedRecord, index: MatchIndex): Promise<string> {
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
        totalRaisedUsd: BigInt(Math.round(c.totalRaisedUsd)),
      });
      await this.writeIdentifiers('company', ownId, r.source, c.identifiers, c.domain, index);
      return ownId;
    }

    // Identifier first: a CIK or a QID is a statement by the publisher about
    // which entity this is. A shared domain is a strong inference and a shared
    // name a weak one, so both stay behind it.
    const matchId =
      (await this.matchByIdentifier('company', c.identifiers, index)) ??
      (c.domain ? index.byDomain.get(c.domain) : undefined) ??
      index.byName.get(normalizeName(c.name));
    if (matchId) {
      await this.enrich(matchId, r);
      await this.writeIdentifiers('company', matchId, r.source, c.identifiers, c.domain, index);
      return matchId;
    }

    const slug = this.uniqueSlug(c.name, r.companyExternalId, index);
    const created = await this.prisma.company.create({
      data: {
        slug,
        name: c.name,
        domain: c.domain ?? '',
        websiteUrl: c.websiteUrl ?? null,
        linkedinUrl: c.linkedinUrl ?? null,
        primarySector: c.primarySector ?? null,
        oneLiner: c.oneLiner ?? `${SEC_ONE_LINER_PREFIX} via SEC Form D.`,
        description: c.description ?? `${c.name} ${SEC_DESCRIPTION_MARKER} notice of exempt offering with the SEC.`,
        hq: c.hq || 'Undisclosed',
        founded: c.foundedYear,
        headcount: c.headcount ?? 0,
        industry: c.industry,
        status: c.status ?? 'Private',
        stage: c.stage,
        totalRaisedUsd: BigInt(Math.round(c.totalRaisedUsd)),
        externalSource: r.source,
        externalId: r.companyExternalId,
        moderationStatus: 'APPROVED',
      },
    });

    index.byKey.set(key, created.id);
    if (c.domain && !index.byDomain.has(c.domain)) index.byDomain.set(c.domain, created.id);
    const norm = normalizeName(c.name);
    if (norm && !index.byName.has(norm)) index.byName.set(norm, created.id);
    await this.writeIdentifiers('company', created.id, r.source, c.identifiers, c.domain, index);
    return created.id;
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
    if (Object.keys(data).length === 0) return;

    const update = { where: { id: companyId }, data };
    if (!this.recordRevisions) {
      await this.prisma.company.update(update);
      return;
    }

    const before =
      known ??
      ((await this.prisma.company.findUnique({ where: { id: companyId } })) as unknown as Record<
        string,
        unknown
      > | null) ??
      {};

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

const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'llc',
  'ltd',
  'limited',
  'co',
  'company',
  'plc',
  'sa',
  'ag',
]);

/** Company-name key for dedupe matching: lowercase, punctuation stripped
 *  (so "L.L.C." → "llc"), trailing legal suffixes dropped, whitespace
 *  collapsed. */
export function normalizeName(name: string): string {
  const tokens = name
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
  const raw = name
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
  };
}

/** Drop the nulls, so an update writes only what the source actually reported. */
function present(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== null && v !== undefined));
}
