import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import {
  ApiMovedPermanentlyResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  MAX_PENDING_API_SUBMISSIONS,
  type ApiKeyWhoAmI,
  type Company,
  type CompanyDetailResponse,
  type FundSummary,
  type InvestorDetailResponse,
  type InvestorSummary,
  type Paginated,
  type PersonDetailResponse,
  type PersonSummary,
  type SearchResponse,
} from '@repo/api';

import { ApiKeyAuth } from '../auth/decorators/api-key.decorator';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { CompaniesService } from '../companies/companies.service';
import { ListFundsDto } from '../funds/dto/list-funds.dto';
import { FundsService } from '../funds/funds.service';
import { ListInvestorsDto } from '../investors/dto/list-investors.dto';
import { InvestorsService } from '../investors/investors.service';
import { ListPeopleDto } from '../people/dto/list-people.dto';
import { PeopleService } from '../people/people.service';
import { SearchQueryDto } from '../search/dto/search-query.dto';
import { SearchService } from '../search/search.service';
import { V1ReadThrottle } from '../throttle/throttle';
import { UsersService } from '../users/users.service';
import { V1ListCompaniesDto } from './dto/v1-list-companies.dto';

/**
 * Public API reads. The same services as the website's routes, so visibility (APPROVED, not
 * merged, not suppressed) is identical. A contributor or admin key's owner is always unlocked
 * on a company profile (`UsersService.accessFor`).
 */
@ApiTags('Read')
@ApiKeyAuth()
@Controller('v1')
export class V1ReadController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly investors: InvestorsService,
    private readonly people: PeopleService,
    private readonly funds: FundsService,
    private readonly searchService: SearchService,
    private readonly users: UsersService,
  ) {}

  /** Who the key belongs to, its scope, and how much of the pending cap is used. */
  @V1ReadThrottle()
  @ApiOperation({ summary: 'Who this key belongs to' })
  @ApiOkResponse({
    description: "The key's owner and scope, and how much of the pending cap is used.",
    schema: {
      example: {
        user: {
          id: 'cm1…',
          name: 'Ada',
          email: 'ada@example.com',
          role: 'CONTRIBUTOR',
        },
        key: { prefix: 'cbk_ab12cd34', scope: 'contributor' },
        pending: 3,
        pendingCap: 500,
      },
    },
  })
  @Get('me')
  async me(@CurrentUser() current: RequestUser): Promise<ApiKeyWhoAmI> {
    const [user, pending] = await Promise.all([
      this.users.findById(current.id),
      this.users.countPending(current.id),
    ]);
    if (!user || !current.apiKey) throw new NotFoundException('User not found');
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      key: { prefix: current.apiKey.prefix, scope: current.apiKey.scope },
      pending,
      pendingCap: user.role === 'ADMIN' ? null : MAX_PENDING_API_SUBMISSIONS,
    };
  }

  @V1ReadThrottle()
  @ApiOperation({
    summary: 'List companies',
    description:
      'One page of public companies. Pass `domain` to check whether a company exists before ' +
      'creating it.',
  })
  @ApiOkResponse({
    description: '`{ items: Company[], total, page, pageSize }`.',
    schema: {
      example: {
        items: [{ slug: 'helia', name: 'Helia', domain: 'helia.com' }],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    },
  })
  @Get('companies')
  listCompanies(@Query() query: V1ListCompaniesDto): Promise<Paginated<Company>> {
    return this.companies.findAllApproved(query);
  }

  /** A merged slug answers 301 with the survivor's slug in the body; follow it. */
  @V1ReadThrottle()
  @ApiOperation({
    summary: 'Get a company profile',
    description: 'The full profile with every section and the citations behind it.',
  })
  @ApiOkResponse({ description: '`{ company, access, citations }`.' })
  @ApiMovedPermanentlyResponse({
    description: 'The slug was merged into another company: `{ slug }` in the body names it.',
  })
  @ApiNotFoundResponse({ description: 'No public company has this slug.' })
  @Get('companies/:slug')
  company(
    @Param('slug') slug: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CompanyDetailResponse> {
    return this.companies.getCompanyDetail(slug, user);
  }

  @V1ReadThrottle()
  @ApiOperation({ summary: 'List investor firms' })
  @ApiOkResponse({
    description: '`{ items: InvestorSummary[], total, page, pageSize }`.',
  })
  @Get('investors')
  listInvestors(@Query() query: ListInvestorsDto): Promise<Paginated<InvestorSummary>> {
    return this.investors.findAll(query);
  }

  @V1ReadThrottle()
  @ApiOperation({ summary: 'Get an investor firm' })
  @ApiOkResponse({
    description: 'The firm, its portfolio, named funds and officers.',
  })
  @ApiMovedPermanentlyResponse({
    description: 'Merged into another firm: `{ slug }` names it.',
  })
  @ApiNotFoundResponse({ description: 'No public firm has this slug.' })
  @Get('investors/:slug')
  investor(@Param('slug') slug: string): Promise<InvestorDetailResponse> {
    return this.investors.findOne(slug);
  }

  @V1ReadThrottle()
  @ApiOperation({ summary: 'List people' })
  @ApiOkResponse({
    description: '`{ items: PersonSummary[], total, page, pageSize }`.',
  })
  @Get('people')
  listPeople(@Query() query: ListPeopleDto): Promise<Paginated<PersonSummary>> {
    return this.people.findAll(query);
  }

  @V1ReadThrottle()
  @ApiOperation({ summary: 'Get a person' })
  @ApiOkResponse({
    description: 'The person and their roles, grouped by organisation.',
  })
  @ApiMovedPermanentlyResponse({
    description: 'Merged into another person: `{ slug }` names it.',
  })
  @ApiNotFoundResponse({ description: 'No public person has this slug.' })
  @Get('people/:slug')
  person(@Param('slug') slug: string): Promise<PersonDetailResponse> {
    return this.people.findOne(slug);
  }

  @V1ReadThrottle()
  @ApiOperation({ summary: 'List private funds' })
  @ApiOkResponse({
    description: '`{ items: FundSummary[], total, page, pageSize }`.',
  })
  @Get('funds')
  listFunds(@Query() query: ListFundsDto): Promise<Paginated<FundSummary>> {
    return this.funds.findAll(query);
  }

  @V1ReadThrottle()
  @ApiOperation({
    summary: 'Search by name',
    description: 'Up to 5 companies, investors and people whose name matches `q`.',
  })
  @ApiOkResponse({ description: '`{ companies, investors, people }`.' })
  @Get('search')
  search(@Query() query: SearchQueryDto): Promise<SearchResponse> {
    return this.searchService.search(query.q);
  }
}
