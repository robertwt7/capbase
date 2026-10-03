// Must stay the first import — see instrument.ts.
import './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

import { AppModule } from './app.module';
import { IngestService } from './ingest/ingest.service';

// One-off CLI: `node dist/backfill [days] [limit] [source]` — runs a single
// ingest pass and exits. Handy for first-load / manual backfills without
// waiting for the cron. `source` is `all` (default) or a source name
// (SEC_EDGAR | WIKIDATA | SEC_ADV | SEC_ADV_FUNDS | SEC_FORM_C | SBIR | SEC_S1).
async function main() {
  const logger = new Logger('Backfill');
  const days = Number(process.argv[2] ?? process.env.INGEST_DAYS ?? '90');
  const limit = Number(process.argv[3] ?? '100000');
  const source = process.argv[4] ?? 'all';
  const sources = source === 'all' ? undefined : [source];

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const ingest = app.get(IngestService);
    const result = await ingest.run({ days, limit, sources });
    logger.log(
      `Backfill done: ${result.upserted}/${result.processed} upserted, ${result.investors} investor firms, ${result.funds} funds`,
    );
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  async (err: unknown) => {
    // A failed manual backfill is as worth knowing about as a failed cron run.
    new Logger('Backfill').error(`Backfill failed: ${String(err)}`);
    Sentry.captureException(err, { tags: { ingest: 'backfill' } });
    await Sentry.flush(5000);
    process.exit(1);
  },
);
