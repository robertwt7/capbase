import { Module } from '@nestjs/common';

import { INGESTION_SOURCES } from '../sources/ingestion-source';
import { AdvClient } from '../sources/sec-adv/adv.client';
import { SecAdvSource } from '../sources/sec-adv/sec-adv.source';
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
    AdvClient,
    SecAdvSource,
    IngestService,
    IngestScheduler,
    // Pluggable list of sources — add OpenCorporates etc. here later.
    {
      provide: INGESTION_SOURCES,
      useFactory: (sec: SecEdgarSource, wikidata: WikidataSource, adv: SecAdvSource) => [
        sec,
        wikidata,
        adv,
      ],
      inject: [SecEdgarSource, WikidataSource, SecAdvSource],
    },
  ],
  exports: [IngestService],
})
export class IngestModule {}
