import { Module } from '@nestjs/common';

import { CompaniesHouseClient } from '../sources/companies-house/companies-house.client';
import { CompaniesHouseSource } from '../sources/companies-house/companies-house.source';
import { InnovateUkClient } from '../sources/innovate-uk/innovate-uk.client';
import { InnovateUkSource } from '../sources/innovate-uk/innovate-uk.source';
import { INGESTION_SOURCES } from '../sources/ingestion-source';
import { PartnerClient } from '../sources/partner/partner.client';
import { PartnerSource } from '../sources/partner/partner.source';
import { SbirClient } from '../sources/sbir/sbir.client';
import { SbirSource } from '../sources/sbir/sbir.source';
import { AdvArchiveClient } from '../sources/sec-adv/adv-archive.client';
import { AdvClient } from '../sources/sec-adv/adv.client';
import { SecAdvFundsSource } from '../sources/sec-adv/sec-adv-funds.source';
import { SecAdvSource } from '../sources/sec-adv/sec-adv.source';
import { EdgarClient } from '../sources/sec-edgar/edgar.client';
import { SecEdgarSource } from '../sources/sec-edgar/sec-edgar.source';
import { FormCClient } from '../sources/sec-form-c/form-c.client';
import { SecFormCSource } from '../sources/sec-form-c/sec-form-c.source';
import { S1Client } from '../sources/sec-s1/s1.client';
import { SecS1Source } from '../sources/sec-s1/sec-s1.source';
import { WikidataClient } from '../sources/wikidata/wikidata.client';
import { WikidataSource } from '../sources/wikidata/wikidata.source';
import { IngestLock } from './ingest-lock';
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
    AdvArchiveClient,
    SecAdvFundsSource,
    FormCClient,
    SecFormCSource,
    SbirClient,
    SbirSource,
    InnovateUkClient,
    InnovateUkSource,
    CompaniesHouseClient,
    CompaniesHouseSource,
    PartnerClient,
    PartnerSource,
    S1Client,
    SecS1Source,
    IngestService,
    IngestLock,
    IngestScheduler,
    // Pluggable list of sources — add OpenCorporates etc. here later.
    // ORDER IS RUN ORDER: IngestService.run filters this list by membership,
    // so a multi-source run follows registration, not INGEST_SOURCES. Innovate
    // UK must precede any UK register source, so the grantees' Companies House
    // numbers are known before the register is swept. The PARTNER
    // snapshot precedes SEC_S1, so S-1 ownership edges (onlyIfKnown) resolve
    // against the partner's firms too.
    {
      provide: INGESTION_SOURCES,
      useFactory: (
        sec: SecEdgarSource,
        wikidata: WikidataSource,
        adv: SecAdvSource,
        advFunds: SecAdvFundsSource,
        formC: SecFormCSource,
        sbir: SbirSource,
        innovateUk: InnovateUkSource,
        companiesHouse: CompaniesHouseSource,
        partner: PartnerSource,
        s1: SecS1Source,
      ) => [sec, wikidata, adv, advFunds, formC, sbir, innovateUk, companiesHouse, partner, s1],
      inject: [
        SecEdgarSource,
        WikidataSource,
        SecAdvSource,
        SecAdvFundsSource,
        SecFormCSource,
        SbirSource,
        InnovateUkSource,
        CompaniesHouseSource,
        PartnerSource,
        SecS1Source,
      ],
    },
  ],
  exports: [IngestService, IngestLock],
})
export class IngestModule {}
