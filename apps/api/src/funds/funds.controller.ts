import { Controller, Get, Query } from '@nestjs/common';
import type { FundSummary, Paginated } from '@repo/api';

import { FundsService } from './funds.service';
import { ListFundsDto } from './dto/list-funds.dto';

@Controller('funds')
export class FundsController {
  constructor(private readonly funds: FundsService) {}

  /** Public read: one page of approved funds. There is no `GET /funds/:id` —
   *  a fund has no page of its own, so nothing addresses one. */
  @Get()
  findAll(@Query() query: ListFundsDto): Promise<Paginated<FundSummary>> {
    return this.funds.findAll(query);
  }
}
