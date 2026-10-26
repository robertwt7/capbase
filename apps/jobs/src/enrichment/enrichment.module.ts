import { Module } from '@nestjs/common';

import { IngestLock } from '../ingest/ingest-lock';
import { PrismaModule } from '../prisma/prisma.module';
import { EnrichmentScheduler } from './enrichment.scheduler';
import { WebsiteEnrichmentService } from './website-enrichment.service';

@Module({
  imports: [PrismaModule],
  providers: [WebsiteEnrichmentService, IngestLock, EnrichmentScheduler],
  exports: [WebsiteEnrichmentService],
})
export class EnrichmentModule {}
