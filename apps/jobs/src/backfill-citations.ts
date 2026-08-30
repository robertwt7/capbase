import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CitableType, SourceType } from '@repo/api';

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { SBIR } from './sources/sbir/sbir.parser';
import {
  SBIR_AWARD_DATA_URL,
  SBIR_DATASET_TITLE,
  SBIR_PUBLISHER,
  awardReference,
} from './sources/sbir/sbir.urls';
import { SEC_ADV } from './sources/sec-adv/adv.parser';
import {
  advFirmUrl,
  filerFormCUrl,
  filerFormDUrl,
  formCOfferingUrl,
  primaryDocUrl,
} from './sources/sec-edgar/edgar.urls';
import { SEC_EDGAR } from './sources/sec-edgar/sec-edgar.source';
import { SEC_FORM_C } from './sources/sec-form-c/form-c.parser';
import { SEC_S1 } from './sources/sec-s1/sec-s1.source';
import { filerS1Url } from './sources/sec-s1/s1.urls';
import { WIKIDATA } from './sources/wikidata/wikidata.mapper';
import { wikidataEntityUrl } from './sources/wikidata/wikidata.urls';

/** Every source whose company rows carry a derivable document URL. */
const CITED_COMPANY_SOURCES = [SEC_EDGAR, WIKIDATA, SEC_FORM_C, SBIR, SEC_S1];

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
  /** Row-level detail when the Source itself cannot carry it. Sources are
   *  deduplicated by URL, so every SBIR row shares one — the award's contract
   *  number belongs on the citation, which is per row. */
  note?: string | null;
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
  /** investorId → its CRD, to cite a fund's manager on Form ADV. */
  private managerCrds = new Map<string, string>();

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
    await this.loadManagerCrds();

    await this.walkCompanies();
    await this.walkRounds();
    await this.walkPeople();
    await this.walkHoldings();
    await this.walkChildren('acquisition', (c) =>
      this.prisma.acquisitionDeal.findMany(childArgs(c)),
    );
    await this.walkChildren('exit', (c) => this.prisma.exitEvent.findMany(childArgs(c)));
    await this.walkInvestorFirms();
    await this.walkFunds();

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
   * Investor id → CRD, for funds. A fund's Schedule D citation is its manager's
   * IAPD page, and the fund row stores the manager as an FK, not a CRD.
   */
  private async loadManagerCrds(): Promise<void> {
    const rows = await this.prisma.investor.findMany({
      where: { crdNumber: { not: null } },
      select: { id: true, crdNumber: true },
    });
    for (const row of rows) this.managerCrds.set(row.id, row.crdNumber!);
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

  /** The CIK for a company, when a Form C filing is what created it. */
  private formCCikFor(companyId: string): string | null {
    const own = this.companies.get(companyId);
    return own?.externalSource === SEC_FORM_C ? own.externalId : null;
  }

  /** The CIK for a company, when an S-1 filing is what created it. */
  private s1CikFor(companyId: string): string | null {
    const own = this.companies.get(companyId);
    return own?.externalSource === SEC_S1 ? own.externalId : null;
  }

  // --- table walks ---------------------------------------------------------

  private async walkCompanies(): Promise<void> {
    await this.eachBatch(
      'company',
      (cursor) =>
        this.prisma.company.findMany({
          where: {
            externalSource: { in: CITED_COMPANY_SOURCES },
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
        switch (row.externalSource) {
          case SEC_EDGAR:
            return secTarget(
              'company',
              row.id,
              filerFormDUrl(id),
              `SEC EDGAR Form D filings (CIK ${id})`,
              id,
              row.updatedAt,
            );
          case SEC_FORM_C:
            return secTarget(
              'company',
              row.id,
              filerFormCUrl(id),
              `SEC EDGAR Form C filings (CIK ${id})`,
              id,
              row.updatedAt,
            );
          case SBIR:
            // The firm key (`uei:…`) is not a public page, so the citation
            // points at the dataset the fact was read from, unreferenced.
            return sbirTarget('company', row.id, null, row.updatedAt);
          case SEC_S1:
            return secTarget(
              'company',
              row.id,
              filerS1Url(id),
              `SEC EDGAR Form S-1 filings (CIK ${id})`,
              id,
              row.updatedAt,
            );
          default:
            return wikidataTarget('company', row.id, id, row.updatedAt);
        }
      },
    );
  }

  private async walkRounds(): Promise<void> {
    await this.eachBatch(
      'round',
      (cursor) =>
        this.prisma.fundingRound.findMany({
          where: {
            externalSource: { in: [SEC_EDGAR, SEC_FORM_C, SBIR] },
            externalId: { not: null },
          },
          select: {
            id: true,
            companyId: true,
            externalSource: true,
            externalId: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...cursor,
        }),
      (row) => {
        const externalId = row.externalId!;

        // A Reg CF round is keyed on its EDGAR file number, which addresses the
        // offering directly — no CIK join needed.
        if (row.externalSource === SEC_FORM_C) {
          return secTarget(
            'round',
            row.id,
            formCOfferingUrl(externalId),
            `SEC Regulation Crowdfunding offering ${externalId}`,
            externalId,
            row.updatedAt,
          );
        }

        // An SBIR award has no derivable public page, so it cites the dataset
        // it was read from, referenced by its contract number.
        if (row.externalSource === SBIR) {
          return sbirTarget('round', row.id, awardReference(externalId), row.updatedAt);
        }

        // The accession alone cannot address a filing — EDGAR's archive path is
        // keyed by CIK. A round whose company was created by another source has
        // no CIK to join to, and a wrong URL is worse than no citation on a
        // feature whose whole point is traceability.
        const cik = this.cikFor(row.companyId);
        if (!cik) return null;
        return secTarget(
          'round',
          row.id,
          primaryDocUrl(cik, externalId),
          `SEC Form D filing ${externalId}`,
          externalId,
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
            externalSource: { in: CITED_COMPANY_SOURCES },
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
        if (row.externalSource === SBIR) {
          // The contact came from the award file, not from any one award page.
          return sbirTarget('person', row.id, null, row.updatedAt);
        }
        if (row.externalSource === SEC_FORM_C) {
          // A signer is named on the offering's filings, so the filer's Form C
          // history is the honest target — the person is not keyed to one of them.
          const formCCik = this.formCCikFor(row.companyId);
          return formCCik
            ? secTarget(
                'person',
                row.id,
                filerFormCUrl(formCCik),
                `SEC EDGAR Form C filings (CIK ${formCCik})`,
                formCCik,
                row.updatedAt,
              )
            : null;
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
   * Acquisitions and exits are Wikidata-only — Form D names the issuer and its
   * officers, never who bought or what was acquired — so they cite their
   * company's QID page. The two tables differ only in which delegate they read,
   * hence the passed-in fetcher.
   */
  private async walkChildren(
    entityType: Extract<CitableType, 'acquisition' | 'exit'>,
    fetch: (cursor: Cursor) => Promise<ChildRow[]>,
  ): Promise<void> {
    await this.eachBatch(entityType, fetch, (row) => {
      const qid = this.qidFor(row.companyId);
      return qid ? wikidataTarget(entityType, row.id, qid, row.updatedAt) : null;
    });
  }

  /**
   * Investor holdings come from two sources now: Wikidata's P1951 edges, which
   * cite the company's QID page, and S-1 principal-stockholder tables, which
   * cite the filer's S-1 history.
   */
  private async walkHoldings(): Promise<void> {
    await this.eachBatch(
      'investor',
      (cursor) =>
        this.prisma.investorHolding.findMany({
          where: {
            externalSource: { in: [WIKIDATA, SEC_S1] },
            externalId: { not: null },
          },
          select: { id: true, companyId: true, externalSource: true, updatedAt: true },
          orderBy: { id: 'asc' as const },
          take: BATCH,
          ...cursor,
        }),
      (row) => {
        if (row.externalSource === SEC_S1) {
          const cik = this.s1CikFor(row.companyId);
          return cik
            ? secTarget(
                'investor',
                row.id,
                filerS1Url(cik),
                `SEC EDGAR Form S-1 filings (CIK ${cik})`,
                cik,
                row.updatedAt,
              )
            : null;
        }
        const qid = this.qidFor(row.companyId);
        return qid ? wikidataTarget('investor', row.id, qid, row.updatedAt) : null;
      },
    );
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

  /**
   * Funds cite up to two documents, because a fund row's facts genuinely come
   * from two places and neither supersedes the other:
   *
   *  - its own Form D filer history (`cikNumber`) attests the vintage, target
   *    and capital closed;
   *  - its manager's Form ADV record (`secFundId` + the manager's CRD) attests
   *    the manager link and the gross asset value.
   *
   * A fund with neither identifier is skipped and counted, as everywhere else.
   */
  private async walkFunds(): Promise<void> {
    await this.eachBatch(
      'fund',
      (cursor) =>
        this.prisma.fund.findMany({
          where: { OR: [{ cikNumber: { not: null } }, { secFundId: { not: null } }] },
          select: {
            id: true,
            managerId: true,
            cikNumber: true,
            secFundId: true,
            updatedAt: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...cursor,
        }),
      (row) => {
        const targets: Target[] = [];
        if (row.cikNumber) {
          targets.push(
            secTarget(
              'fund',
              row.id,
              filerFormDUrl(row.cikNumber),
              `SEC EDGAR Form D filings (CIK ${row.cikNumber})`,
              row.cikNumber,
              row.updatedAt,
            ),
          );
        }
        const crd = this.managerCrds.get(row.managerId);
        if (row.secFundId && crd) {
          targets.push({
            ...secTarget(
              'fund',
              row.id,
              advFirmUrl(crd),
              `SEC Form ADV — CRD ${crd}`,
              crd,
              row.updatedAt,
            ),
            // The manager's IAPD page is shared by every one of that firm's
            // funds and Sources deduplicate by URL, so the per-fund 805 id
            // belongs on the citation — same reasoning as the SBIR contract
            // number above.
            note: `Private fund ${row.secFundId}`,
          });
        }
        return targets.length > 0 ? targets : null;
      },
    );
  }

  // --- machinery -----------------------------------------------------------

  /** Keyset-paginate one table, writing a citation for every row that yields a
   *  target. Keyset (not offset) so the scan stays O(n) on big tables. */
  private async eachBatch<T extends { id: string }>(
    label: string,
    fetch: (cursor: Cursor) => Promise<T[]>,
    target: (row: T) => Target | Target[] | null,
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
        // A row may cite more than one document: a fund's dates come from its
        // Form D and its manager link from Form ADV, and both are real.
        const targets = [target(row) ?? []].flat();
        if (targets.length === 0) {
          this.skipped += 1;
          continue;
        }
        for (const t of targets) await this.cite(t);
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
        note: t.note ?? null,
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

/** SBIR rows all cite the same bulk file — the document they were actually read
 *  from — with the award's contract number as the reference where there is one. */
function sbirTarget(
  entityType: CitableType,
  entityId: string,
  reference: string | null,
  retrievedAt: Date,
): Target {
  return {
    entityType,
    entityId,
    url: SBIR_AWARD_DATA_URL,
    sourceType: 'Government dataset',
    publisher: SBIR_PUBLISHER,
    title: SBIR_DATASET_TITLE,
    // The whole corpus shares one Source row (deduplicated by URL), so the
    // per-award identifier goes on the citation instead, which is per row.
    reference: null,
    note: reference ? `Contract ${reference}` : null,
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
