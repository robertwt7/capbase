import { Module } from '@nestjs/common';

import { INGESTION_SOURCES } from '../sources/ingestion-source';
import { EdgarClient } from '../sources/sec-edgar/edgar.client';
import { SecEdgarSource } from '../sources/sec-edgar/sec-edgar.source';
import { IngestScheduler } from './ingest.scheduler';
import { IngestService } from './ingest.service';

@Module({
  providers: [
    EdgarClient,
    SecEdgarSource,
    IngestService,
    IngestScheduler,
    // Pluggable list of sources — add Wikidata/OpenCorporates here later.
    {
      provide: INGESTION_SOURCES,
      useFactory: (sec: SecEdgarSource) => [sec],
      inject: [SecEdgarSource],
    },
  ],
  exports: [IngestService],
})
export class IngestModule {}
