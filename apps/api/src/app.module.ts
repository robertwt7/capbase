import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env';
import { CompaniesModule } from './companies/companies.module';
import { FundsModule } from './funds/funds.module';
import { InvestorsModule } from './investors/investors.module';
import { MarketModule } from './market/market.module';
import { PeopleModule } from './people/people.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    InvestorsModule,
    PeopleModule,
    FundsModule,
    MarketModule,
    AdminModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
