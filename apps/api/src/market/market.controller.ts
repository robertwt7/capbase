import { Controller, Get } from '@nestjs/common';
import type { MarketStat, MarketTotals } from '@repo/api';

import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('stats')
  stats(): Promise<MarketStat[]> {
    return this.market.getStats();
  }

  @Get('totals')
  totals(): Promise<MarketTotals> {
    return this.market.getTotals();
  }
}
