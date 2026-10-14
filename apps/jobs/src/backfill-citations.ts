import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { runCitationBackfill } from './ingest/citation-backfill';
import { PrismaService } from './prisma/prisma.service';

// One-off CLI: `node dist/backfill-citations.js` — mints Source + Citation rows
// for the whole corpus from stored provenance (ingest/citation-backfill.ts).
// No network; idempotent, so re-run it after each ingest.
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    await runCitationBackfill(app.get(PrismaService));
  } finally {
    await app.close();
  }
}

void main().then(() => process.exit(0));
