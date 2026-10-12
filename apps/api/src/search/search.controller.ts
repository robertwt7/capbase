import { Controller, Get, Query } from '@nestjs/common';
import type { SearchResponse } from '@repo/api';

import { SearchThrottle } from '../throttle/throttle';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  // Public read for the header typeahead. Three ranked ILIKE queries, so it
  // shares the directory lists' limit.
  @SearchThrottle()
  @Get()
  find(@Query() query: SearchQueryDto): Promise<SearchResponse> {
    return this.search.search(query.q);
  }
}
