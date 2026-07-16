import { Module } from '@nestjs/common';

import { INGESTION_SOURCES } from '../sources/ingestion-source';
import { EdgarClient } from '../sources/sec-edgar/edgar.client';
import { SecEdgarSource } from '../sources/sec-edgar/sec-edgar.source';
import { WikidataClient } from '../sources/wikidata/wikidata.client';
import { WikidataSource } from '../sources/wikidata/wikidata.source';
import { IngestScheduler } from './ingest.scheduler';
import { IngestService } from './ingest.service';

@Module({
  providers: [
    EdgarClient,
    SecEdgarSource,
    WikidataClient,
    WikidataSource,
    IngestService,
    IngestScheduler,
    // Pluggable list of sources — add OpenCorporates etc. here later.
    {
      provide: INGESTION_SOURCES,
      useFactory: (sec: SecEdgarSource, wikidata: WikidataSource) => [sec, wikidata],
      inject: [SecEdgarSource, WikidataSource],
    },
  ],
  exports: [IngestService],
})
export class IngestModule {}
