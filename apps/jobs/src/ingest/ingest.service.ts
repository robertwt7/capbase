import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  INGESTION_SOURCES,
  type IngestionSource,
  type NormalizedFiling,
} from '../sources/ingestion-source';

export interface IngestResult {
  processed: number;
  upserted: number;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INGESTION_SOURCES) private readonly sources: IngestionSource[],
  ) {}

  /** Run every configured source and upsert its filings. Idempotent: rows are
   *  keyed by (externalSource, externalId), so re-runs update in place. */
  async run(limit: number): Promise<IngestResult> {
    let processed = 0;
    let upserted = 0;

    for (const source of this.sources) {
      this.logger.log(`Ingesting from ${source.name} (limit ${limit})`);
      const filings = await source.fetchRecent(limit);
      processed += filings.length;
      for (const filing of filings) {
        try {
          await this.upsert(filing);
          upserted += 1;
        } catch (err) {
          const e = err as { code?: string; meta?: unknown; message?: string };
          this.logger.warn(
            `Upsert failed for ${filing.companyExternalId}: code=${e.code} meta=${JSON.stringify(e.meta)} ${e.message?.split('\n')[0]}`,
          );
        }
      }
    }

    this.logger.log(`Ingest complete: ${upserted}/${processed} upserted`);
    return { processed, upserted };
  }

  private async upsert(f: NormalizedFiling): Promise<void> {
    const slug = `${kebab(f.company.name)}-${f.companyExternalId.slice(-6)}`;
    const total = BigInt(Math.round(f.company.totalRaisedUsd));

    // Ingested rows are auto-APPROVED (SEC is an official source) and tagged
    // with their provenance for idempotent upserts + later attribution.
    const company = await this.prisma.company.upsert({
      where: {
        externalSource_externalId: {
          externalSource: f.source,
          externalId: f.companyExternalId,
        },
      },
      create: {
        slug,
        name: f.company.name,
        domain: '',
        oneLiner: 'Private securities offering disclosed via SEC Form D.',
        description: `${f.company.name} filed a Form D notice of exempt offering with the SEC.`,
        hq: f.company.hq || 'Undisclosed',
        founded: f.company.foundedYear,
        headcount: 0,
        industry: f.company.industry,
        status: 'Private',
        stage: f.company.stage,
        totalRaisedUsd: total,
        externalSource: f.source,
        externalId: f.companyExternalId,
        moderationStatus: 'APPROVED',
      },
      update: {
        name: f.company.name,
        hq: f.company.hq || 'Undisclosed',
        industry: f.company.industry,
        stage: f.company.stage,
        totalRaisedUsd: total,
      },
    });

    await this.prisma.fundingRound.upsert({
      where: {
        externalSource_externalId: {
          externalSource: f.source,
          externalId: f.roundExternalId,
        },
      },
      create: {
        companyId: company.id,
        name: f.round.name,
        date: new Date(f.round.date),
        amountUsd: BigInt(Math.round(f.round.amountUsd)),
        externalSource: f.source,
        externalId: f.roundExternalId,
        moderationStatus: 'APPROVED',
      },
      update: {
        amountUsd: BigInt(Math.round(f.round.amountUsd)),
        date: new Date(f.round.date),
      },
    });
  }
}

function kebab(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'company';
}
