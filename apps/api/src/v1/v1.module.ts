import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CompaniesModule } from '../companies/companies.module';
import { FundsModule } from '../funds/funds.module';
import { InvestorsModule } from '../investors/investors.module';
import { PeopleModule } from '../people/people.module';
import { SearchModule } from '../search/search.module';
import { UsersModule } from '../users/users.module';
import { V1AdminController } from './v1-admin.controller';
import { V1ReadController } from './v1-read.controller';
import { V1WriteController } from './v1-write.controller';
import { V1WriteService } from './v1-write.service';

/**
 * The public, key-authenticated API (`/v1`). These controllers are its entire surface — the
 * only API routes nginx exposes — and they call the website's own services, so validation,
 * attribution, citations and visibility are identical. Every route needs a `Bearer cbk_…` key.
 */
@Module({
  imports: [
    ApiKeysModule,
    UsersModule,
    CompaniesModule,
    InvestorsModule,
    PeopleModule,
    FundsModule,
    SearchModule,
    AdminModule,
  ],
  controllers: [V1ReadController, V1WriteController, V1AdminController],
  providers: [V1WriteService],
})
export class V1Module {}
