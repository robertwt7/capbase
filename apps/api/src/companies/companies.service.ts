import { Injectable, NotFoundException } from '@nestjs/common';
import type { Company } from '@repo/api';
import { PrismaService } from '../prisma/prisma.service';
import { toCompany } from './company.mapper';
import { CreateCompanyDto } from './dto/create-company.dto';
import {
  CreateAcquisitionDto,
  CreateDiversityDto,
  CreateExitDto,
  CreateFundingRoundDto,
  CreateInvestorDto,
  CreatePersonDto,
} from './dto/contributions.dto';

const approvedChildren = {
  rounds: {
    where: { moderationStatus: 'APPROVED' as const },
    include: { investors: true },
    orderBy: { date: 'asc' as const },
  },
  people: { where: { moderationStatus: 'APPROVED' as const } },
  investors: { where: { moderationStatus: 'APPROVED' as const } },
  acquisitions: {
    where: { moderationStatus: 'APPROVED' as const },
    orderBy: { date: 'asc' as const },
  },
  exits: {
    where: { moderationStatus: 'APPROVED' as const },
    orderBy: { date: 'asc' as const },
  },
  diversity: { where: { moderationStatus: 'APPROVED' as const } },
};

const money = (v: number | null | undefined): bigint | null =>
  v === null || v === undefined ? null : BigInt(v);

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllApproved(): Promise<Company[]> {
    const rows = await this.prisma.company.findMany({
      where: { moderationStatus: 'APPROVED' },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => toCompany(row));
  }

  async findOneApproved(slug: string): Promise<Company> {
    const row = await this.prisma.company.findFirst({
      where: { slug, moderationStatus: 'APPROVED' },
      include: approvedChildren,
    });
    if (!row) throw new NotFoundException(`Company "${slug}" not found`);
    return toCompany(row);
  }

  async createCompany(dto: CreateCompanyDto, userId: string) {
    const slug = await this.uniqueSlug(dto.name);
    const created = await this.prisma.company.create({
      data: {
        slug,
        name: dto.name,
        domain: dto.domain,
        oneLiner: dto.oneLiner,
        description: dto.description,
        hq: dto.hq,
        founded: dto.founded,
        headcount: dto.headcount,
        industry: dto.industry,
        status: dto.status,
        stage: dto.stage,
        totalRaisedUsd: BigInt(dto.totalRaisedUsd),
        lastValuationUsd: money(dto.lastValuationUsd),
        revenueUsd: money(dto.financials?.revenueUsd),
        revenueGrowthPct: dto.financials?.revenueGrowthPct ?? null,
        grossMarginPct: dto.financials?.grossMarginPct ?? null,
        burnMonths: dto.financials?.burnMonths ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, slug: created.slug, moderationStatus: created.moderationStatus };
  }

  async addRound(slug: string, dto: CreateFundingRoundDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.fundingRound.create({
      data: {
        companyId: company.id,
        name: dto.name,
        date: new Date(dto.date),
        amountUsd: BigInt(dto.amountUsd),
        postMoneyUsd: money(dto.postMoneyUsd),
        lead: dto.lead ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
        investors: { create: dto.investors.map((i) => ({ name: i.name, lead: i.lead })) },
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addPerson(slug: string, dto: CreatePersonDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.person.create({
      data: {
        companyId: company.id,
        name: dto.name,
        role: dto.role,
        since: dto.since,
        prior: dto.prior ?? null,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addInvestor(slug: string, dto: CreateInvestorDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.investorHolding.create({
      data: {
        companyId: company.id,
        name: dto.name,
        type: dto.type,
        firstRound: dto.firstRound,
        rounds: dto.rounds,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addAcquisition(slug: string, dto: CreateAcquisitionDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.acquisitionDeal.create({
      data: {
        companyId: company.id,
        target: dto.target,
        date: new Date(dto.date),
        amountUsd: money(dto.amountUsd),
        rationale: dto.rationale,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addExit(slug: string, dto: CreateExitDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.exitEvent.create({
      data: {
        companyId: company.id,
        type: dto.type,
        date: new Date(dto.date),
        valueUsd: money(dto.valueUsd),
        detail: dto.detail,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  async addDiversity(slug: string, dto: CreateDiversityDto, userId: string) {
    const company = await this.requireCompany(slug);
    const created = await this.prisma.diversitySignal.create({
      data: {
        companyId: company.id,
        label: dto.label,
        value: dto.value,
        note: dto.note,
        moderationStatus: 'PENDING',
        submittedById: userId,
      },
    });
    return { id: created.id, moderationStatus: created.moderationStatus };
  }

  private async requireCompany(slug: string) {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company) throw new NotFoundException(`Company "${slug}" not found`);
    return company;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'company';
    let slug = base;
    let n = 1;
    while (await this.prisma.company.findUnique({ where: { slug } })) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }
}
