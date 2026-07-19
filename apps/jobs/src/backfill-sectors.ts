import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { SEC_EDGAR } from './sources/sec-edgar/sec-edgar.source';
import { secSector } from './sources/sec-edgar/sector-map';
import { sectorFor } from './sources/wikidata/wikidata.mapper';

const BATCH = 500;

// One-off CLI: `node dist/backfill-sectors.js` — fills missing
// Company.primarySector from the stored industry[] values. SEC rows use the
// deterministic Form D map; everything else falls back to the Wikidata keyword
// rules. Idempotent: only NULL sectors are ever touched, never overwritten.
async function main() {
  const logger = new Logger('BackfillSectors');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    let scanned = 0;
    let updated = 0;
    let cursor: string | undefined;

    for (;;) {
      const rows = await prisma.company.findMany({
        where: { primarySector: null, NOT: { industry: { isEmpty: true } } },
        select: { id: true, industry: true, externalSource: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      scanned += rows.length;

      for (const row of rows) {
        const sector =
          row.externalSource === SEC_EDGAR
            ? secSector(row.industry[0] ?? '')
            : sectorFor(row.industry.join(' '));
        if (!sector) continue;
        await prisma.company.update({ where: { id: row.id }, data: { primarySector: sector } });
        updated++;
      }
      logger.log(`Progress: ${updated} updated / ${scanned} scanned`);
    }

    logger.log(`Backfill done: ${updated} sectors filled across ${scanned} scanned companies`);
  } finally {
    await app.close();
  }
}

void main().then(() => process.exit(0));
