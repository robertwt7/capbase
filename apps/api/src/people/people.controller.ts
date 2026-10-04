import { Controller, Get, Param, Query } from '@nestjs/common';
import type {
  Paginated,
  PersonDetailResponse,
  PersonSlugEntry,
  PersonSummary,
} from '@repo/api';

import { PeopleService } from './people.service';
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
  sitemap(): Promise<PersonSlugEntry[]> {
    return this.people.listSlugs();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<PersonDetailResponse> {
    return this.people.findOne(slug);
  }
}
