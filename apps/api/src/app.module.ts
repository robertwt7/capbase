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
import { DEFAULT_LIMIT, THROTTLE_MESSAGE } from './throttle/throttle';
import { UsersModule } from './users/users.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // In-memory counters: one API process. The guard is ApiThrottlerGuard (AuthModule).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ...DEFAULT_LIMIT }],
      errorMessage: THROTTLE_MESSAGE,
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    InvestorsModule,
    PeopleModule,
    FundsModule,
    MarketModule,
    AdminModule,
    ReportsModule,
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
