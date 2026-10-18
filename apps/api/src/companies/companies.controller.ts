import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type {
  Company,
  CompanyDetailResponse,
  CompanyHistoryResponse,
  CompanySlugEntry,
  SitemapCount,
  CountryFacet,
  FeaturedCompaniesResponse,
  Paginated,
} from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Contribution } from '../auth/decorators/contribution.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CompaniesService } from './companies.service';
import { SitemapPageDto } from '../prisma/sitemap-page.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateAcquisitionDto,
  CreateDiversityDto,
  CreateExitDto,
  CreateFundingRoundDto,
  CreateInvestorDto,
  CreatePersonDto,
} from './dto/contributions.dto';
import { CreateChangeProposalDto } from './dto/create-proposal.dto';
import { FeaturedCompaniesDto, ListCompaniesDto } from './dto/list-companies.dto';
import { SearchThrottle } from '../throttle/throttle';
import { CompanyHistoryDto } from './dto/company-history.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  // --- Public reads (approved data only) ---

  // Optional auth: a signed-in viewer also sees partner companies and values.
  @SearchThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(@Query() query: ListCompaniesDto, @CurrentUser() user?: RequestUser): Promise<Paginated<Company>> {
    return this.companies.findAllApproved(query, user);
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  // Optional auth: the rows are public, but the response reports the viewer's
  // contribution gate so the landing page knows how much to blur.
  @UseGuards(OptionalJwtAuthGuard)
  @Get('featured')
  featured(
    @Query() query: FeaturedCompaniesDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<FeaturedCompaniesResponse> {
    return this.companies.findFeatured(query.limit, user);
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  @Get('countries')
  countries(): Promise<CountryFacet[]> {
    return this.companies.countries();
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  @Get('sitemap')
  sitemap(@Query() query: SitemapPageDto): Promise<CompanySlugEntry[]> {
    return this.companies.listSlugs(query.page ?? 0);
  }

  /** Sizes the sitemap index: how many `SITEMAP_PAGE_SIZE` pages to list. */
  @Get('sitemap/count')
  async sitemapCount(): Promise<SitemapCount> {
    return { count: await this.companies.countSlugs() };
  }

  // Declared before @Get(':slug') so the more specific path wins over the param
  // route. Public, but gated like the profile: a locked viewer sees the
  // allowlisted entries and a count of the rest — see getCompanyHistory.
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':slug/history')
  history(
    @Param('slug') slug: string,
    @Query() query: CompanyHistoryDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<CompanyHistoryResponse> {
    return this.companies.getCompanyHistory(slug, query.page, query.pageSize, user);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':slug')
  findOne(
    @Param('slug') slug: string,
    @CurrentUser() user?: RequestUser,
  ): Promise<CompanyDetailResponse> {
    return this.companies.getCompanyDetail(slug, user);
  }

  // --- Contributions (any authenticated user; created as PENDING) ---
  // Each is capped by the user's pending backlog and Turnstile-checked.

  @Contribution()
  @Post()
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: RequestUser) {
    return this.companies.createCompany(dto, user.id);
  }

  @Contribution()
  @Post(':slug/rounds')
  addRound(
    @Param('slug') slug: string,
    @Body() dto: CreateFundingRoundDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addRound(slug, dto, user.id);
  }

  @Contribution()
  @Post(':slug/people')
  addPerson(
    @Param('slug') slug: string,
    @Body() dto: CreatePersonDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addPerson(slug, dto, user.id);
  }

  @Contribution()
  @Post(':slug/investors')
  addInvestor(
    @Param('slug') slug: string,
    @Body() dto: CreateInvestorDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addInvestor(slug, dto, user.id);
  }

  @Contribution()
  @Post(':slug/acquisitions')
  addAcquisition(
    @Param('slug') slug: string,
    @Body() dto: CreateAcquisitionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addAcquisition(slug, dto, user.id);
  }

  @Contribution()
  @Post(':slug/exits')
  addExit(
    @Param('slug') slug: string,
    @Body() dto: CreateExitDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addExit(slug, dto, user.id);
  }

  @Contribution()
  @Post(':slug/diversity')
  addDiversity(
    @Param('slug') slug: string,
    @Body() dto: CreateDiversityDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addDiversity(slug, dto, user.id);
  }

  @Contribution()
  @Post(':slug/proposals')
  propose(
    @Param('slug') slug: string,
    @Body() dto: CreateChangeProposalDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.proposeChange(slug, dto, user.id);
  }
}
