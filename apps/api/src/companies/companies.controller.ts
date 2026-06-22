import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { Company } from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateAcquisitionDto,
  CreateDiversityDto,
  CreateExitDto,
  CreateFundingRoundDto,
  CreateInvestorDto,
  CreatePersonDto,
} from './dto/contributions.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  // --- Public reads (approved data only) ---

  @Get()
  findAll(): Promise<Company[]> {
    return this.companies.findAllApproved();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<Company> {
    return this.companies.findOneApproved(slug);
  }

  // --- Contributions (any authenticated user; created as PENDING) ---

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: RequestUser) {
    return this.companies.createCompany(dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/rounds')
  addRound(
    @Param('slug') slug: string,
    @Body() dto: CreateFundingRoundDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addRound(slug, dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/people')
  addPerson(
    @Param('slug') slug: string,
    @Body() dto: CreatePersonDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addPerson(slug, dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/investors')
  addInvestor(
    @Param('slug') slug: string,
    @Body() dto: CreateInvestorDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addInvestor(slug, dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/acquisitions')
  addAcquisition(
    @Param('slug') slug: string,
    @Body() dto: CreateAcquisitionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addAcquisition(slug, dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/exits')
  addExit(
    @Param('slug') slug: string,
    @Body() dto: CreateExitDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addExit(slug, dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/diversity')
  addDiversity(
    @Param('slug') slug: string,
    @Body() dto: CreateDiversityDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.companies.addDiversity(slug, dto, user.id);
  }
}
