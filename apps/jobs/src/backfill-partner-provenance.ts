// Must stay the first import — see instrument.ts.
import './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { IngestLock } from './ingest/ingest-lock';
import { PartnerProvenanceBackfill } from './ingest/partner-provenance';
import { PrismaService } from './prisma/prisma.service';
import { PartnerClient } from './sources/partner/partner.client';

// One-off CLI: `node dist/backfill-partner-provenance.js` — reconstructs which
// rows exist only because of the partner (`partnerOnly`), which column values it
// wrote into other sources' rows (`partnerFields`) and which round investors it
// named (`RoundInvestor.externalSource`), for data loaded before ingest recorded
// them. Needs the `partner_stage` schema loaded: it is the only record of what
// the partner stated. No network. Idempotent — a second run changes 0 rows.
// Holds the ingest lock, because a partner stage running alongside would write
// marks this pass is computing.
async function main() {
  const logger = new Logger('BackfillPartnerProvenance');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const client = app.get(PartnerClient);
    if (!(await client.stageLoaded())) {
      logger.error('partner stage not loaded — load it with `make partner-stage-load FILE=…` first');
      process.exitCode = 1;
      return;
    }
    const backfill = new PartnerProvenanceBackfill(app.get(PrismaService), client, (m) => logger.log(m));
    const locked = await app.get(IngestLock).runExclusive('backfill-partner-provenance', () => backfill.run());
    if (!locked.ran) {
      logger.error('Another ingest holds the lock (the cron?) — retry when it finishes');
      process.exitCode = 75; // EX_TEMPFAIL
      return;
    }
    const c = locked.result;
    logger.log(
      `Backfill done — partner-only: ${c.companiesPartnerOnly} companies, ${c.investorsPartnerOnly} investors, ` +
        `${c.fundsPartnerOnly} funds; field marks: ${c.companyFields} companies, ${c.investorFields} investors, ` +
        `${c.fundFields} funds, ${c.roundFields} rounds; ${c.roundInvestors} round investors tagged`,
    );
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    new Logger('BackfillPartnerProvenance').error(`Backfill failed: ${String(err)}`);
    process.exit(1);
  },
);
