// Must stay first so Sentry can instrument Nest and database modules.
import './instrument';

import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

import { parseEnrichmentArgs, readEnrichmentConfig } from './enrichment/enrichment-config';
import { WebsiteEnrichmentService } from './enrichment/website-enrichment.service';
import { IngestLock } from './ingest/ingest-lock';
import { PrismaModule } from './prisma/prisma.module';

// No ScheduleModule, EnrichmentScheduler or IngestModule: a bounded CLI must
// never start another background ingest while it performs its requested run.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [WebsiteEnrichmentService, IngestLock],
})
class TechnologyBackfillModule {}

async function main(): Promise<void> {
  const options = parseEnrichmentArgs(process.argv.slice(2));
  const logger = new Logger('BackfillTechnologies');
  const app = await NestFactory.createApplicationContext(TechnologyBackfillModule, { logger: ['log', 'warn', 'error'] });
  const controller = new AbortController();
  const interrupted = () => controller.abort(new Error('Technology enrichment interrupted'));
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = readEnrichmentConfig(app.get(ConfigService), { forCli: true });
    const locked = await app.get(IngestLock).runExclusive('website technology backfill', async () => {
      timer = setTimeout(() => controller.abort(new Error('Technology enrichment deadline reached')), config.timeoutMs);
      const service = app.get(WebsiteEnrichmentService);
      if (options.suppressScan) {
        await service.suppress(options.suppressScan, options.technology!, options.reason!, !options.unsuppress);
        return { action: options.unsuppress ? 'unsuppress' : 'suppress', scanId: options.suppressScan, technology: options.technology };
      }
      if (options.appLink) {
        await service.reviewApp(options.appLink, options.appAction!, options.reason!, options.evidenceUrl);
        return { action: options.appAction, appLink: options.appLink };
      }
      const result = await service.run({ limit: options.limit, dryRun: options.dryRun, slug: options.slug, signal: controller.signal });
      if (controller.signal.aborted) throw new Error('Technology enrichment stopped before completion');
      return result;
    });
    if (!locked.ran) {
      logger.warn('Another ingest holds the lock; retry after it finishes');
      process.exitCode = 75;
      return;
    }
    logger.log(`Technology ${options.dryRun ? 'dry-run' : 'backfill'} complete: ${JSON.stringify(locked.result)}`);
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    await app.close();
  }
}

if (require.main === module) {
  main().catch(async (err: unknown) => {
    new Logger('BackfillTechnologies').error(`Technology backfill failed: ${String(err)}`);
    Sentry.captureException(err, { tags: { enrichment: 'backfill' } });
    await Sentry.flush(5000);
    process.exitCode = 1;
  });
}
