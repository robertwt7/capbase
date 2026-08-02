import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  INGESTION_SOURCES,
  type FetchOptions,
  type IngestionSource,
  type NormalizedInvestor,
  type NormalizedInvestorFirm,
  type NormalizedRecord,
} from '../sources/ingestion-source';
import { kebab } from '../util/slug';

export interface IngestResult {
  processed: number;
  upserted: number;
  /** Investor firms upserted from sources that publish an investor universe. */
  investors: number;
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

/** The same lookup tables for investor firms. */
interface InvestorIndex {
  /** `${externalSource}:${externalId}` → investor id. */
  byKey: Map<string, string>;
  /** domain → investor id (first wins). */
  byDomain: Map<string, string>;
  /** normalizeInvestorName(name) → investor id (first wins). */
  byName: Map<string, string>;
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
      return { processed: 0, upserted: 0, investors: 0 };
    }

    const index = await this.loadMatchIndex();
    const investorIndex = await this.loadInvestorIndex();
    let processed = 0;
    let upserted = 0;
    let investors = 0;

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
      if (!source.fetchInvestors) continue;
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

    this.logger.log(`Ingest complete: ${upserted}/${processed} upserted, ${investors} investor firms`);
    return { processed, upserted, investors };
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

  private async loadInvestorIndex(): Promise<InvestorIndex> {
    const existing = await this.prisma.investor.findMany({
      select: { id: true, slug: true, name: true, domain: true, externalSource: true, externalId: true },
    });
    const index: InvestorIndex = {
      byKey: new Map(),
      byDomain: new Map(),
      byName: new Map(),
      slugs: new Set(),
    };
    for (const i of existing) {
      if (i.externalSource && i.externalId) {
        index.byKey.set(`${i.externalSource}:${i.externalId}`, i.id);
      }
      if (i.domain && !index.byDomain.has(i.domain)) index.byDomain.set(i.domain, i.id);
      const norm = normalizeInvestorName(i.name);
      if (norm && !index.byName.has(norm)) index.byName.set(norm, i.id);
      index.slugs.add(i.slug);
    }
    return index;
  }

  private async upsert(
    r: NormalizedRecord,
    index: MatchIndex,
    investorIndex: InvestorIndex,
  ): Promise<void> {
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
      // Every holding resolves to a first-class Investor row, minting one if the
      // firm is new. This is the invariant the nullable investorId column relies on.
      const investorId = await this.resolveInvestor(i, r.source, investorIndex);
      await this.prisma.investorHolding.upsert({
        where: {
          externalSource_externalId: { externalSource: r.source, externalId: i.externalId },
        },
        create: {
          companyId,
          investorId,
          name: i.name,
          type: i.type,
          firstRound: i.firstRound,
          rounds: i.rounds,
          externalSource: r.source,
          externalId: i.externalId,
          moderationStatus: 'APPROVED',
        },
        update: { investorId, type: i.type, firstRound: i.firstRound, rounds: i.rounds },
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

  /** Resolve a holding's investor to an Investor id, creating a minimal row when
   *  the firm is new. Matching order mirrors upsertCompany: provenance key →
   *  normalized name. Holdings carry no website, so there is no domain to match on. */
  private async resolveInvestor(
    i: NormalizedInvestor,
    source: string,
    index: InvestorIndex,
  ): Promise<string | null> {
    const norm = normalizeInvestorName(i.name);
    if (!norm) return null;

    const key = i.investorExternalId ? `${source}:${i.investorExternalId}` : null;
    const known = (key ? index.byKey.get(key) : undefined) ?? index.byName.get(norm);
    if (known) return known;

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
    return created.id;
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
      return;
    }

    // Domain first — it is the only high-confidence signal. ADV contains real
    // false friends ("Sequoia Planning & Investments LLC", a "Benchmark Capital
    // Group Ltd." that is a wealth manager), so a name-only match must never
    // overwrite anything.
    const matchId =
      (domain ? index.byDomain.get(domain) : undefined) ??
      index.byName.get(normalizeInvestorName(firm.name));
    if (matchId) {
      await this.enrichInvestor(matchId, facts);
      index.byKey.set(key, matchId);
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

