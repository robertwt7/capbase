import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { SearchResponse } from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { SearchThrottle } from '../throttle/throttle';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  // Public read for the header typeahead. Three ranked ILIKE queries, so it
  // shares the directory lists' limit. Optional auth: signed out, the
  // partner's entities are not found.
  @SearchThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  find(@Query() query: SearchQueryDto, @CurrentUser() user?: RequestUser): Promise<SearchResponse> {
    return this.search.search(query.q, user);
  }
}
