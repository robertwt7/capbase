import { Module } from '@nestjs/common';

import { CompaniesModule } from '../companies/companies.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { MarketsSitemapController } from './markets-sitemap.controller';

@Module({
  imports: [CompaniesModule],
  controllers: [MarketController, MarketsSitemapController],
  providers: [MarketService],
})
export class MarketModule {}
