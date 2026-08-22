import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CitableType, SourceType } from '@repo/api';

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { SEC_ADV } from './sources/sec-adv/adv.parser';
import { advFirmUrl, filerFormDUrl, primaryDocUrl } from './sources/sec-edgar/edgar.urls';
import { SEC_EDGAR } from './sources/sec-edgar/sec-edgar.source';
import { WIKIDATA } from './sources/wikidata/wikidata.mapper';
import { wikidataEntityUrl } from './sources/wikidata/wikidata.urls';

const BATCH = 500;

/**
 * One-off CLI: `node dist/backfill-citations.js` — mints Source + Citation rows
 * for the entire existing corpus from provenance we already store.
 *
 * Every URL is *constructed* from the identifiers on the row (CIK + accession,
 * QID, CRD), so this is a purely local operation: no source is re-fetched.
 * Idempotent — Sources upsert by url, Citations by their 4-column unique key —
 * so it is safe to re-run after each new ingest.
 *
 * Backfilled citations are all whole-row (`field: ''`): the stored provenance
 * attests the row, not one column of it. Field-level citations come from
 * contributors attaching a source to an edit proposal.
 */
async function main() {
  const logger = new Logger('BackfillCitations');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const backfill = new CitationBackfill(prisma, logger);
    await backfill.run();
  } finally {
    await app.close();
  }
}

/** Keyset page marker: absent on the first batch, then the previous batch's
 *  last id (skipped, so the page starts after it). */
type Cursor = { cursor?: { id: string }; skip?: number };

/** A citation about to be written, and the document it points at. */
interface Target {
  entityType: CitableType;
  entityId: string;
  url: string;
  sourceType: SourceType;
  publisher: string;
  title: string;
  reference: string | null;
  /**
   * Best available proxy for "when we read this": the cited row's `updatedAt`.
   * It is when we last *wrote* what the document said, not when we read the
   * document — close enough to be useful, and honest about being derived.
   */
  retrievedAt: Date;
}

/** A company's own provenance, used to resolve its children's source URLs. */
interface CompanyProvenance {
  externalSource: string;
  externalId: string;
}

class CitationBackfill {
  private readonly sourceIds = new Map<string, string>();
  /** companyId → its own (externalSource, externalId). */
  private companies = new Map<string, CompanyProvenance>();
  /** companyId → the accession of its most recent SEC Form D round. */
  private latestFiling = new Map<string, string>();

  private sources = 0;
  private citations = 0;
  private skipped = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  async run(): Promise<void> {
    await this.loadCompanyProvenance();
    await this.loadLatestFilings();

    await this.walkCompanies();
    await this.walkRounds();
    await this.walkPeople();
    await this.walkChildren('investor', (c) => this.prisma.investorHolding.findMany(childArgs(c)));
    await this.walkChildren('acquisition', (c) =>
      this.prisma.acquisitionDeal.findMany(childArgs(c)),
    );
    await this.walkChildren('exit', (c) => this.prisma.exitEvent.findMany(childArgs(c)));
    await this.walkInvestorFirms();

    this.logger.log(
      `Backfill done: ${this.citations} citations across ${this.sources} sources ` +
        `(${this.skipped} rows skipped — no derivable URL)`,
    );
  }

  // --- lookups -------------------------------------------------------------

  private async loadCompanyProvenance(): Promise<void> {
    const rows = await this.prisma.company.findMany({
      where: { externalSource: { not: null }, externalId: { not: null } },
      select: { id: true, externalSource: true, externalId: true },
    });
    for (const row of rows) {
      this.companies.set(row.id, {
        externalSource: row.externalSource!,
        externalId: row.externalId!,
      });
    }
    this.logger.log(`Loaded provenance for ${this.companies.size} companies`);
  }

  /**
   * The filing each company's people most likely came from. Form D names its
   * related persons, so a person's citation should point at a filing rather
   * than the filer's whole history — and the newest one is the filing whose
   * `relatedPersonsList` last wrote the row.
   */
  private async loadLatestFilings(): Promise<void> {
    const rows = await this.prisma.fundingRound.findMany({
      where: { externalSource: SEC_EDGAR, externalId: { not: null } },
      select: { companyId: true, externalId: true, date: true },
      orderBy: { date: 'asc' },
    });
    // Ascending, so the last write per company wins.
    for (const row of rows) this.latestFiling.set(row.companyId, row.externalId!);
  }

  /** The CIK for a company, when its own provenance is a SEC Form D filer. */
  private cikFor(companyId: string): string | null {
    const own = this.companies.get(companyId);
    return own?.externalSource === SEC_EDGAR ? own.externalId : null;
  }

  /** The QID for a company, when Wikidata is what created it. */
  private qidFor(companyId: string): string | null {
    const own = this.companies.get(companyId);
    return own?.externalSource === WIKIDATA ? own.externalId : null;
  }

  // --- table walks ---------------------------------------------------------

  private async walkCompanies(): Promise<void> {
    await this.eachBatch(
      'company',
      (cursor) =>
        this.prisma.company.findMany({
          where: {
            externalSource: { in: [SEC_EDGAR, WIKIDATA] },
            externalId: { not: null },
          },
          select: {
            id: true,
            externalSource: true,
            externalId: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...cursor,
        }),
      (row) => {
        const id = row.externalId!;
        if (row.externalSource === SEC_EDGAR) {
          return secTarget(
            'company',
            row.id,
            filerFormDUrl(id),
            `SEC EDGAR Form D filings (CIK ${id})`,
            id,
            row.updatedAt,
          );
        }
        return wikidataTarget('company', row.id, id, row.updatedAt);
      },
    );
  }

  private async walkRounds(): Promise<void> {
    await this.eachBatch(
      'round',
      (cursor) =>
        this.prisma.fundingRound.findMany({
          where: { externalSource: SEC_EDGAR, externalId: { not: null } },
          select: {
            id: true,
            companyId: true,
            externalId: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...cursor,
        }),
      (row) => {
        // The accession alone cannot address a filing — EDGAR's archive path is
        // keyed by CIK. A round whose company was created by another source has
        // no CIK to join to, and a wrong URL is worse than no citation on a
        // feature whose whole point is traceability.
        const cik = this.cikFor(row.companyId);
        if (!cik) return null;
        const accession = row.externalId!;
        return secTarget(
          'round',
          row.id,
          primaryDocUrl(cik, accession),
          `SEC Form D filing ${accession}`,
          accession,
          row.updatedAt,
        );
      },
    );
  }

  private async walkPeople(): Promise<void> {
    await this.eachBatch(
      'person',
      (cursor) =>
        this.prisma.person.findMany({
          where: {
            externalSource: { in: [SEC_EDGAR, WIKIDATA] },
            externalId: { not: null },
          },
          select: {
            id: true,
            companyId: true,
            externalSource: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...cursor,
        }),
      (row) => {
        if (row.externalSource === WIKIDATA) {
          const qid = this.qidFor(row.companyId);
          return qid ? wikidataTarget('person', row.id, qid, row.updatedAt) : null;
        }
        const cik = this.cikFor(row.companyId);
        if (!cik) return null;
        const accession = this.latestFiling.get(row.companyId);
        return accession
          ? secTarget(
              'person',
              row.id,
              primaryDocUrl(cik, accession),
              `SEC Form D filing ${accession}`,
              accession,
              row.updatedAt,
            )
          : secTarget(
              'person',
              row.id,
              filerFormDUrl(cik),
              `SEC EDGAR Form D filings (CIK ${cik})`,
              cik,
              row.updatedAt,
            );
      },
    );
  }

  /**
   * Investor holdings, acquisitions and exits are Wikidata-only — Form D names
   * the issuer and its officers, never who bought or what was acquired — so
   * they all cite their company's QID page. The three tables differ only in
   * which delegate they read, hence the passed-in fetcher.
   */
  private async walkChildren(
    entityType: Extract<CitableType, 'investor' | 'acquisition' | 'exit'>,
    fetch: (cursor: Cursor) => Promise<ChildRow[]>,
  ): Promise<void> {
    await this.eachBatch(entityType, fetch, (row) => {
      const qid = this.qidFor(row.companyId);
      return qid ? wikidataTarget(entityType, row.id, qid, row.updatedAt) : null;
    });
  }

  /** Standalone investor firms carry their own identifier: a CRD from Form ADV
   *  or a QID from Wikidata. No company join needed. */
  private async walkInvestorFirms(): Promise<void> {
    await this.eachBatch(
      'investor',
      (cursor) =>
        this.prisma.investor.findMany({
          where: {
            externalSource: { in: [SEC_ADV, WIKIDATA] },
            externalId: { not: null },
          },
          select: {
            id: true,
            externalSource: true,
            externalId: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...cursor,
        }),
      (row) => {
        const id = row.externalId!;
        if (row.externalSource === SEC_ADV) {
          return secTarget(
            'investor',
            row.id,
            advFirmUrl(id),
            `SEC Form ADV — CRD ${id}`,
            id,
            row.updatedAt,
          );
        }
        return wikidataTarget('investor', row.id, id, row.updatedAt);
      },
    );
  }

  // --- machinery -----------------------------------------------------------

  /** Keyset-paginate one table, writing a citation for every row that yields a
   *  target. Keyset (not offset) so the scan stays O(n) on big tables. */
  private async eachBatch<T extends { id: string }>(
    label: string,
    fetch: (cursor: Cursor) => Promise<T[]>,
    target: (row: T) => Target | null,
  ): Promise<void> {
    let cursor: string | undefined;
    let scanned = 0;
    let written = 0;

    for (;;) {
      const rows = await fetch(cursor ? { cursor: { id: cursor }, skip: 1 } : {});
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      scanned += rows.length;

      for (const row of rows) {
        const t = target(row);
        if (!t) {
          this.skipped += 1;
          continue;
        }
        await this.cite(t);
        written += 1;
      }
    }

    if (scanned > 0) this.logger.log(`${label}: ${written} cited / ${scanned} scanned`);
  }

  /** Upsert the Source (deduplicated by URL), then the Citation. */
  private async cite(t: Target): Promise<void> {
    const sourceId = await this.sourceIdFor(t);
    await this.prisma.citation.upsert({
      where: {
        sourceId_entityType_entityId_field: {
          sourceId,
          entityType: t.entityType,
          entityId: t.entityId,
          field: '',
        },
      },
      create: {
        sourceId,
        entityType: t.entityType,
        entityId: t.entityId,
        field: '',
      },
      update: {},
    });
    this.citations += 1;
  }

  private async sourceIdFor(t: Target): Promise<string> {
    const cached = this.sourceIds.get(t.url);
    if (cached) return cached;

    const row = await this.prisma.source.upsert({
      where: { url: t.url },
      create: {
        url: t.url,
        sourceType: t.sourceType,
        title: t.title,
        publisher: t.publisher,
        reference: t.reference,
        retrievedAt: t.retrievedAt,
      },
      // Never clobber an existing row: its retrievedAt may come from a real
      // fetch, which beats this backfill's proxy.
      update: {},
      select: { id: true },
    });

    this.sourceIds.set(t.url, row.id);
    this.sources += 1;
    return row.id;
  }
}

/** The columns every Wikidata-sourced child row contributes to its citation. */
interface ChildRow {
  id: string;
  companyId: string;
  updatedAt: Date;
}

/** Identical query args for all three Wikidata-only child tables. */
function childArgs(cursor: Cursor) {
  return {
    where: { externalSource: WIKIDATA, externalId: { not: null } },
    select: { id: true, companyId: true, updatedAt: true },
    orderBy: { id: 'asc' as const },
    take: BATCH,
    ...cursor,
  };
}

function secTarget(
  entityType: CitableType,
  entityId: string,
  url: string,
  title: string,
  reference: string,
  retrievedAt: Date,
): Target {
  return {
    entityType,
    entityId,
    url,
    sourceType: 'SEC filing',
    publisher: 'SEC',
    title,
    reference,
    retrievedAt,
  };
}

function wikidataTarget(
  entityType: CitableType,
  entityId: string,
  qid: string,
  retrievedAt: Date,
): Target {
  return {
    entityType,
    entityId,
    url: wikidataEntityUrl(qid),
    sourceType: 'Wikidata',
    publisher: 'Wikidata',
    title: `Wikidata entity ${qid}`,
    reference: qid,
    retrievedAt,
  };
}

void main().then(() => process.exit(0));
