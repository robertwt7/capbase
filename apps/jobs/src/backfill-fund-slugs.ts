// Must stay the first import — see instrument.ts.
import './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { planFundSlugs } from './ingest/fund-slug';
import { IngestLock } from './ingest/ingest-lock';
import { PrismaService } from './prisma/prisma.service';

const BATCH = 2_000;

// One-off CLI: `node dist/backfill-fund-slugs.js` — gives every fund written
// before fund pages existed a unique `slug`, so it gets a page at
// /funds/<slug>. No network. Idempotent: only NULL slugs are touched, so a
// second run writes 0. Holds the ingest lock, because an ingest minting slugs at
// the same time could take one this pass has planned.
async function main() {
  const logger = new Logger('BackfillFundSlugs');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const locked = await app.get(IngestLock).runExclusive('backfill-fund-slugs', async () => {
      const slugs = new Set(
        (
          await prisma.fund.findMany({ where: { slug: { not: null } }, select: { slug: true } })
        ).map((f) => f.slug!),
      );
      let written = 0;
      let cursor: string | undefined;
      for (;;) {
        // `id > cursor`, not Prisma's `cursor` + `skip: 1`: the rows just
        // written leave the `slug: null` filter, so the cursor row is no longer
        // in the result and `skip: 1` would silently drop a real one per page.
        const rows = await prisma.fund.findMany({
          where: { slug: null, ...(cursor ? { id: { gt: cursor } } : {}) },
          select: { id: true, name: true, externalId: true },
          orderBy: { id: 'asc' },
          take: BATCH,
        });
        if (rows.length === 0) break;
        cursor = rows[rows.length - 1]!.id;
        const plan = planFundSlugs(rows, slugs);
        await prisma.$transaction(
          plan.map((p) => prisma.fund.update({ where: { id: p.id }, data: { slug: p.slug } })),
        );
        written += plan.length;
        logger.log(`Progress: ${written} slugs written`);
      }
      return written;
    });
    if (!locked.ran) {
      logger.error('Another ingest holds the lock (the cron?) — retry when it finishes');
      process.exitCode = 75; // EX_TEMPFAIL
      return;
    }
    logger.log(`Backfill done: ${locked.result} fund slugs written`);
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    new Logger('BackfillFundSlugs').error(`Backfill failed: ${String(err)}`);
    process.exit(1);
  },
);
