import { Controller, Get, Param, Query } from '@nestjs/common';
import type {
  Paginated,
  PersonDetailResponse,
  PersonSlugEntry,
  SitemapCount,
  PersonSummary,
} from '@repo/api';

import { PeopleService } from './people.service';
import { SitemapPageDto } from '../prisma/sitemap-page.dto';
import { ListPeopleDto } from './dto/list-people.dto';
import { SearchThrottle } from '../throttle/throttle';

@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  // Public read: one page of public people.
  @SearchThrottle()
  @Get()
  findAll(@Query() query: ListPeopleDto): Promise<Paginated<PersonSummary>> {
    return this.people.findAll(query);
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  @Get('sitemap')
  sitemap(@Query() query: SitemapPageDto): Promise<PersonSlugEntry[]> {
    return this.people.listSlugs(query.page ?? 0);
  }

  /** Sizes the sitemap index: how many `SITEMAP_PAGE_SIZE` pages to list. */
  @Get('sitemap/count')
  async sitemapCount(): Promise<SitemapCount> {
    return { count: await this.people.countSlugs() };
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<PersonDetailResponse> {
    return this.people.findOne(slug);
  }
}
