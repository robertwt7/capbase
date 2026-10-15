import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiKeyAuth, KeyContribution } from '../auth/decorators/api-key.decorator';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { CompaniesService } from '../companies/companies.service';
import {
  CreateAcquisitionDto,
  CreateDiversityDto,
  CreateExitDto,
  CreateFundingRoundDto,
  CreateInvestorDto,
  CreatePersonDto,
} from '../companies/dto/contributions.dto';
import { CreateCompanyDto } from '../companies/dto/create-company.dto';
import { CreateChangeProposalDto } from '../companies/dto/create-proposal.dto';
import { CreateInvestorProposalDto } from '../investors/dto/create-investor-proposal.dto';
import { InvestorsService } from '../investors/investors.service';
import { V1WriteThrottle } from '../throttle/throttle';
import { V1WriteService } from './v1-write.service';

/**
 * Public API writes. The website's DTOs and services, so validation, attribution (the key's
 * owner), citations and the `attested` requirement are identical. The guard stack replaces
 * Turnstile with the key and uses the key pending cap (MAX_PENDING_API_SUBMISSIONS).
 */
/** What every write answers. */
const CREATED = {
  description:
    '`{ id, moderationStatus }` (plus `slug` for a company). `PENDING` with a contributor key; ' +
    '`APPROVED` with an admin key, published as if approved in the queue.',
  schema: { example: { id: 'cm1…', moderationStatus: 'PENDING' } },
};
const INVALID = {
  description:
    'Validation failed (`message` lists each field), including a missing `attested: true`.',
};
const NO_COMPANY = { description: 'No company has this slug.' };

@ApiTags('Write')
@ApiCreatedResponse(CREATED)
@ApiBadRequestResponse(INVALID)
@ApiKeyAuth()
@Controller('v1')
export class V1WriteController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly investors: InvestorsService,
    private readonly writes: V1WriteService,
  ) {}

  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({
    summary: 'Add a company',
    description: 'Check `GET /v1/companies?domain=` first, so the same company is not added twice.',
  })
  @Post('companies')
  async createCompany(@Body() dto: CreateCompanyDto, @CurrentUser() user: RequestUser) {
    return this.writes.publish(user, 'company', await this.companies.createCompany(dto, user.id));
  }

  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({ summary: 'Add a funding round to a company' })
  @ApiNotFoundResponse(NO_COMPANY)
  @Post('companies/:slug/rounds')
  async addRound(
    @Param('slug') slug: string,
    @Body() dto: CreateFundingRoundDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(user, 'round', await this.companies.addRound(slug, dto, user.id));
  }

  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({ summary: 'Add a person (a role) to a company' })
  @ApiNotFoundResponse(NO_COMPANY)
  @Post('companies/:slug/people')
  async addPerson(
    @Param('slug') slug: string,
    @Body() dto: CreatePersonDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(user, 'person', await this.companies.addPerson(slug, dto, user.id));
  }

  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({
    summary: 'Add an investor to a company',
    description: 'Links to the firm of that exact name, or creates it.',
  })
  @ApiNotFoundResponse(NO_COMPANY)
  @Post('companies/:slug/investors')
  async addInvestor(
    @Param('slug') slug: string,
    @Body() dto: CreateInvestorDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(
      user,
      'investor',
      await this.companies.addInvestor(slug, dto, user.id),
    );
  }

  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({ summary: 'Add an acquisition the company made' })
  @ApiNotFoundResponse(NO_COMPANY)
  @Post('companies/:slug/acquisitions')
  async addAcquisition(
    @Param('slug') slug: string,
    @Body() dto: CreateAcquisitionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(
      user,
      'acquisition',
      await this.companies.addAcquisition(slug, dto, user.id),
    );
  }

  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({ summary: 'Add an exit (IPO, acquisition, …)' })
  @ApiNotFoundResponse(NO_COMPANY)
  @Post('companies/:slug/exits')
  async addExit(
    @Param('slug') slug: string,
    @Body() dto: CreateExitDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(user, 'exit', await this.companies.addExit(slug, dto, user.id));
  }

  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({ summary: 'Add a diversity signal' })
  @ApiNotFoundResponse(NO_COMPANY)
  @Post('companies/:slug/diversity')
  async addDiversity(
    @Param('slug') slug: string,
    @Body() dto: CreateDiversityDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(
      user,
      'diversity',
      await this.companies.addDiversity(slug, dto, user.id),
    );
  }

  /** A field-level edit to a company. Keys equal to the current values are dropped; an empty
   *  diff is a 400. */
  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({
    summary: 'Propose an edit to a company',
    description:
      'Send only the fields to change. Fields equal to the current value are dropped; nothing left is a 400.',
  })
  @ApiNotFoundResponse(NO_COMPANY)
  @Post('companies/:slug/proposals')
  async proposeCompanyEdit(
    @Param('slug') slug: string,
    @Body() dto: CreateChangeProposalDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(
      user,
      'proposal',
      await this.companies.proposeChange(slug, dto, user.id),
    );
  }

  /** A field-level edit to an investor firm. API only: there is no website form. Approval
   *  updates the firm and keeps the replaced values on the proposal; it writes no revision. */
  @V1WriteThrottle()
  @KeyContribution()
  @ApiOperation({
    summary: 'Propose an edit to an investor firm',
    description:
      'Send only the fields to change. Fields equal to the current value are dropped; nothing left is a 400.',
  })
  @ApiNotFoundResponse({ description: 'No public firm has this slug.' })
  @Post('investors/:slug/proposals')
  async proposeInvestorEdit(
    @Param('slug') slug: string,
    @Body() dto: CreateInvestorProposalDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.writes.publish(
      user,
      'investorProposal',
      await this.investors.proposeChange(slug, dto, user.id),
    );
  }
}
