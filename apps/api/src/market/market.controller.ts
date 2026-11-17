import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { MarketStat, MarketTotals, VerticalMarketResponse, VerticalStat } from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
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

  /** Every vertical with at least one member, with its public counts. */
  @Get('verticals')
  verticals(): Promise<VerticalStat[]> {
    return this.market.verticalStats();
  }

  // Optional auth: a signed-in viewer also sees partner-derived members and values.
  @UseGuards(OptionalJwtAuthGuard)
  @Get('verticals/:slug')
  vertical(@Param('slug') slug: string, @CurrentUser() user?: RequestUser): Promise<VerticalMarketResponse> {
    return this.market.verticalMarket(slug, user);
  }
}
