// Must stay the first import — see instrument.ts.
import './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { IngestLock } from './ingest/ingest-lock';
import { IngestService } from './ingest/ingest.service';
import { PartnerInvestorFocusBackfill, focusPreflight, focusSummary } from './ingest/partner-investor-focus';
import { PrismaService } from './prisma/prisma.service';
import { PartnerClient } from './sources/partner/partner.client';

// One-off CLI: `node dist/backfill-partner-investor-focus.js` — writes the
// partner's reported investment focus (stages, strategies, industries,
// geography, initial-equity / typical-commitment ranges) onto the investor
// firms it owns or matched by domain. Needs a v2 `partner_stage` loaded. No
// firms re-run: no firm column, person, role or private contact is written. No
// network. Idempotent — a second run writes 0 rows. Holds the ingest lock, like
// every other ingest write.
async function main() {
  const logger = new Logger('BackfillPartnerInvestorFocus');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const client = app.get(PartnerClient);
    const refused = await focusPreflight(client);
    if (refused) {
      logger.error(refused);
      process.exitCode = 1;
      return;
    }
    const backfill = new PartnerInvestorFocusBackfill(app.get(PrismaService), client, app.get(IngestService), (m) =>
      logger.log(m),
    );
    const locked = await app.get(IngestLock).runExclusive('backfill-partner-investor-focus', () => backfill.run());
    if (!locked.ran) {
      logger.error('Another ingest holds the lock (the cron?) — retry when it finishes');
      process.exitCode = 75; // EX_TEMPFAIL
      return;
    }
    logger.log(`Backfill done — ${focusSummary(locked.result)}`);
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    new Logger('BackfillPartnerInvestorFocus').error(`Backfill failed: ${String(err)}`);
    process.exit(1);
  },
);
