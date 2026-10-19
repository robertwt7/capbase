// Must stay the first import — see instrument.ts.
import './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { refreshDirectoryCounts } from '@repo/db';

import { AppModule } from './app.module';
import { IngestLock } from './ingest/ingest-lock';
import { PrismaService } from './prisma/prisma.service';

// One-off CLI: `node dist/backfill-directory-counts.js` — fills the stored
// /people and /investors sort keys (Person.roleCount / companyCount,
// Investor.holdingCount) for rows written before the columns existed, and
// re-runs the full refresh by hand. No network. Idempotent: only rows whose
// value changed are written, so a second run writes 0. Holds the ingest lock,
// because an ingest moving roles at the same time would race the pass (every
// ingest run ends with this same refresh anyway).
async function main() {
  const logger = new Logger('BackfillDirectoryCounts');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const locked = await app
      .get(IngestLock)
      .runExclusive('backfill-directory-counts', () => refreshDirectoryCounts(prisma));
    if (!locked.ran) {
      logger.error('Another ingest holds the lock (the cron?) — retry when it finishes');
      process.exitCode = 75; // EX_TEMPFAIL
      return;
    }
    logger.log(`Backfill done: ${locked.result.people} people, ${locked.result.investors} investors updated`);
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    new Logger('BackfillDirectoryCounts').error(`Backfill failed: ${String(err)}`);
    process.exit(1);
  },
);
