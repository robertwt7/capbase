import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { IngestService } from './ingest/ingest.service';

// One-off CLI: `node dist/backfill [limit]` — runs a single ingest pass and
// exits. Handy for first-load / manual backfills without waiting for the cron.
async function main() {
  const logger = new Logger('Backfill');
  const limit = Number(process.argv[2] ?? process.env.INGEST_LIMIT ?? '50');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const ingest = app.get(IngestService);
    const result = await ingest.run(limit);
    logger.log(`Backfill done: ${result.upserted}/${result.processed} upserted`);
  } finally {
    await app.close();
  }
}

void main().then(() => process.exit(0));
