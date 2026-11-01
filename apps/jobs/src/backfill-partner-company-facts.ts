// Must stay the first import — see instrument.ts.
import './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { IngestLock } from './ingest/ingest-lock';
import { IngestService } from './ingest/ingest.service';
import { PartnerCompanyFactsBackfill } from './ingest/partner-company-facts';
import { PrismaService } from './prisma/prisma.service';
import { PartnerClient } from './sources/partner/partner.client';

// One-off CLI: `node dist/backfill-partner-company-facts.js` — fills the
// industry labels and location the partner states on companies it matched but
// did not create, where they were left blank (enrichment used to skip both).
// Goes through ingest's own enrichment, so each fill writes a revision and a
// partner field mark; never writes prose, name, stage, status or totals. Needs
// the `partner_stage` schema loaded. No network. Idempotent — a second run
// writes 0 rows. Holds the ingest lock, like every other ingest write.
async function main() {
  const logger = new Logger('BackfillPartnerCompanyFacts');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    if (!(await app.get(PartnerClient).stageLoaded())) {
      logger.error('partner stage not loaded — load it with `make partner-stage-load FILE=…` first');
      process.exitCode = 1;
      return;
    }
    const backfill = new PartnerCompanyFactsBackfill(app.get(PrismaService), app.get(IngestService), (m) =>
      logger.log(m),
    );
    const locked = await app.get(IngestLock).runExclusive('backfill-partner-company-facts', () => backfill.run());
    if (!locked.ran) {
      logger.error('Another ingest holds the lock (the cron?) — retry when it finishes');
      process.exitCode = 75; // EX_TEMPFAIL
      return;
    }
    const c = locked.result;
    logger.log(`Backfill done — ${c.candidates} candidates: ${c.written} written, ${c.unchanged} unchanged`);
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    new Logger('BackfillPartnerCompanyFacts').error(`Backfill failed: ${String(err)}`);
    process.exit(1);
  },
);
