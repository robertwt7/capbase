import { Module } from '@nestjs/common';

import { INGESTION_SOURCES } from '../sources/ingestion-source';
import { SbirClient } from '../sources/sbir/sbir.client';
import { SbirSource } from '../sources/sbir/sbir.source';
import { AdvClient } from '../sources/sec-adv/adv.client';
import { SecAdvSource } from '../sources/sec-adv/sec-adv.source';
import { EdgarClient } from '../sources/sec-edgar/edgar.client';
import { SecEdgarSource } from '../sources/sec-edgar/sec-edgar.source';
import { FormCClient } from '../sources/sec-form-c/form-c.client';
import { SecFormCSource } from '../sources/sec-form-c/sec-form-c.source';
import { S1Client } from '../sources/sec-s1/s1.client';
import { SecS1Source } from '../sources/sec-s1/sec-s1.source';
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
    FormCClient,
    SecFormCSource,
    SbirClient,
    SbirSource,
    S1Client,
    SecS1Source,
    IngestService,
    IngestScheduler,
    // Pluggable list of sources — add OpenCorporates etc. here later.
    {
      provide: INGESTION_SOURCES,
      useFactory: (
        sec: SecEdgarSource,
        wikidata: WikidataSource,
        adv: SecAdvSource,
        formC: SecFormCSource,
        sbir: SbirSource,
        s1: SecS1Source,
      ) => [sec, wikidata, adv, formC, sbir, s1],
      inject: [
        SecEdgarSource,
        WikidataSource,
        SecAdvSource,
        SecFormCSource,
        SbirSource,
        SecS1Source,
      ],
    },
  ],
  exports: [IngestService],
})
export class IngestModule {}
