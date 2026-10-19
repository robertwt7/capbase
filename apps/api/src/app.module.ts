import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env';
import { CompaniesModule } from './companies/companies.module';
import { FundsModule } from './funds/funds.module';
import { InvestorsModule } from './investors/investors.module';
import { MarketModule } from './market/market.module';
import { PeopleModule } from './people/people.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SearchModule } from './search/search.module';
import { DEFAULT_LIMIT, THROTTLE_MESSAGE, V1_DAILY_THROTTLER } from './throttle/throttle';
import { UsersModule } from './users/users.module';
import { V1Module } from './v1/v1.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // In-memory counters: one API process. The guard is ApiThrottlerGuard (AuthModule).
    // `daily` is the /v1 per-account quota; it skips every request not made with a live key.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ...DEFAULT_LIMIT }, V1_DAILY_THROTTLER],
      errorMessage: THROTTLE_MESSAGE,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    InvestorsModule,
    PeopleModule,
    FundsModule,
    SearchModule,
    MarketModule,
    AdminModule,
    ReportsModule,
    V1Module,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    // Reports unexpected errors (not HttpExceptions — a 404 or a 400 is the API
    // working) to GlitchTip, then answers like Nest's default filter.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
