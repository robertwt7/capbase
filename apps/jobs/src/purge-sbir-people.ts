import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { SBIR } from './sources/sbir/sbir.parser';

const BATCH = 500;

/**
 * One-off CLI: `node dist/purge-sbir-people.js` — deletes the SBIR person rows
 * written from the award file's `Contact Name` column.
 *
 * They are not company people. Measured over the corpus, the column named the
 * federal desk that processed the award: the top names are NSF SBIR program
 * directors at 299, 249 and 222 distinct companies each, and all 10,963 rows
 * came from the same mistake. `sbir.parser.ts` now reads `PI Name` instead, so
 * a re-ingest writes principal investigators and never recreates these.
 *
 * NOT part of `ingest-all`: it is a one-shot correction of rows already
 * written, not a recurring step. A from-scratch rebuild never needs it, because
 * the fixed parser never writes them.
 *
 * Idempotent — a second run finds nothing and deletes nothing.
 */
async function main() {
  const logger = new Logger('PurgeSbirPeople');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    let people = 0;
    let citations = 0;

    for (;;) {
      // No cursor: each pass deletes what it read, so the next page is always
      // the first one. Ordered by id purely for a deterministic log.
      const rows = await prisma.personRole.findMany({
        where: { externalSource: SBIR },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);

      // One transaction per batch: a citation must never outlive the row it
      // attests, and a half-applied batch would leave exactly that.
      //
      // The `Source` rows those citations point at are deliberately LEFT: a
      // Source is deduplicated by URL and shared across entities, so deleting
      // one another row cites would be a bug. backfill-citations is idempotent
      // and will not re-mint a citation for a row that no longer exists.
      const [deletedCitations, deletedPeople] = await prisma.$transaction([
        prisma.citation.deleteMany({
          where: { entityType: 'person', entityId: { in: ids } },
        }),
        prisma.personRole.deleteMany({ where: { id: { in: ids } } }),
      ]);

      citations += deletedCitations.count;
      people += deletedPeople.count;
      logger.log(`Progress: ${people} people, ${citations} citations deleted`);
    }

    logger.log(`Purge done: ${people} SBIR person rows and ${citations} citations deleted`);
  } finally {
    await app.close();
  }
}

void main().then(() => process.exit(0));
