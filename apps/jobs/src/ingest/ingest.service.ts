import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  INGESTION_SOURCES,
  type FetchOptions,
  type IngestionSource,
  type NormalizedRecord,
} from '../sources/ingestion-source';
import { kebab } from '../util/slug';

export interface IngestResult {
  processed: number;
  upserted: number;
}

export interface RunOptions extends FetchOptions {
  /** Restrict the run to these source names (all sources when absent). */
  sources?: string[];
}

/** Preloaded lookup tables for match-&-enrich (one query per run). */
interface MatchIndex {
  /** `${externalSource}:${externalId}` → company id. */
  byKey: Map<string, string>;
  /** domain → company id (first wins). */
  byDomain: Map<string, string>;
  /** normalizeName(name) → company id (first wins). */
  byName: Map<string, string>;
  /** Every slug in use, to mint unique ones without extra queries. */
  slugs: Set<string>;
}

// The generic copy written on SEC-created rows; a richer source may replace it.
const SEC_ONE_LINER_PREFIX = 'Private securities offering disclosed';
const SEC_DESCRIPTION_MARKER = 'filed a Form D';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INGESTION_SOURCES) private readonly sources: IngestionSource[],
  ) {}

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
      return { processed: 0, upserted: 0 };
    }

    const index = await this.loadMatchIndex();
    let processed = 0;
    let upserted = 0;

    for (const source of active) {
      this.logger.log(`Ingesting from ${source.name} (days ${opts.days}, limit ${opts.limit})`);
      const records = await source.fetch(opts);
      processed += records.length;
      let done = 0;
      for (const record of records) {
        try {
          await this.upsert(record, index);
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
    }

    this.logger.log(`Ingest complete: ${upserted}/${processed} upserted`);
    return { processed, upserted };
  }

  private async loadMatchIndex(): Promise<MatchIndex> {
    const existing = await this.prisma.company.findMany({
      select: { id: true, slug: true, name: true, domain: true, externalSource: true, externalId: true },
    });
    const index: MatchIndex = {
      byKey: new Map(),
      byDomain: new Map(),
      byName: new Map(),
      slugs: new Set(),
    };
    for (const c of existing) {
      if (c.externalSource && c.externalId) {
        index.byKey.set(`${c.externalSource}:${c.externalId}`, c.id);
      }
      if (c.domain && !index.byDomain.has(c.domain)) index.byDomain.set(c.domain, c.id);
      const norm = normalizeName(c.name);
      if (norm && !index.byName.has(norm)) index.byName.set(norm, c.id);
      index.slugs.add(c.slug);
    }
    return index;
  }

  private async upsert(r: NormalizedRecord, index: MatchIndex): Promise<void> {
    const companyId = await this.upsertCompany(r, index);

    if (r.round) {
      await this.prisma.fundingRound.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: r.round.externalId },
        },
        create: {
          companyId,
          name: r.round.name,
          date: new Date(r.round.date),
          amountUsd: BigInt(Math.round(r.round.amountUsd)),
          externalSource: r.source,
          externalId: r.round.externalId,
          moderationStatus: 'APPROVED',
        },
        update: {
          amountUsd: BigInt(Math.round(r.round.amountUsd)),
          date: new Date(r.round.date),
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
      await this.prisma.investorHolding.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: i.externalId },
        },
        create: {
          companyId,
          name: i.name,
          type: i.type,
          firstRound: i.firstRound,
          rounds: i.rounds,
          externalSource: r.source,
          externalId: i.externalId,
          moderationStatus: 'APPROVED',
        },
        update: { type: i.type, firstRound: i.firstRound, rounds: i.rounds },
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

  /** Resolve the record to a company row: update its own provenance-keyed row,
   *  enrich a domain/name match, or create a new row. Returns the company id. */
  private async upsertCompany(r: NormalizedRecord, index: MatchIndex): Promise<string> {
    const key = `${r.source}:${r.companyExternalId}`;
    const c = r.company;

    const ownId = index.byKey.get(key);
    if (ownId) {
      await this.prisma.company.update({
        where: { id: ownId },
        data: {
          name: c.name,
          hq: c.hq || 'Undisclosed',
          industry: c.industry,
          stage: c.stage,
          totalRaisedUsd: BigInt(Math.round(c.totalRaisedUsd)),
        },
      });
      return ownId;
    }

    const matchId =
      (c.domain ? index.byDomain.get(c.domain) : undefined) ??
      index.byName.get(normalizeName(c.name));
    if (matchId) {
      await this.enrich(matchId, r);
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

    if (Object.keys(data).length > 0) {
      await this.prisma.company.update({ where: { id: companyId }, data });
    }
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
