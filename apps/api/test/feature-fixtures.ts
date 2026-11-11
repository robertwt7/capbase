import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Prisma, Role } from '@repo/db';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueAlertsService } from '../src/admin/queue-alerts.service';

/** Synthetic ids only. Never calls auth endpoints or cleans up someone else's rows. */
export async function featureFixtures(
  overrides?: (builder: ReturnType<typeof Test.createTestingModule>) => void,
) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  builder
    .overrideProvider(QueueAlertsService)
    .useValue({ onApplicationBootstrap() {}, onApplicationShutdown() {} });
  overrides?.(builder);
  const module = await builder.compile();
  const app: INestApplication = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);
  const users: string[] = [];
  const companies: string[] = [];
  const investors: string[] = [];
  const prefix = `monitor-${randomUUID()}`;
  const user = async (role: Role = 'CONTRIBUTOR') => {
    const row = await prisma.user.create({
      data: {
        email: `${randomUUID()}@monitor.invalid`,
        name: 'Monitoring fixture',
        passwordHash: 'unused-fixture',
        role,
        emailVerifiedAt: new Date(),
      },
    });
    users.push(row.id);
    return {
      ...row,
      token: jwt.sign({
        sub: row.id,
        email: row.email,
        role: row.role,
        tv: row.tokenVersion,
      }),
    };
  };
  const company = async (data: Partial<Prisma.CompanyCreateInput> = {}) => {
    const id = randomUUID();
    const row = await prisma.company.create({
      data: {
        name: `${prefix}-${id}`,
        slug: `${prefix}-${id}`,
        domain: '',
        oneLiner: 'Fixture',
        description: 'Fixture',
        hq: 'Sydney',
        countryCode: 'AU',
        primarySector: 'Fintech',
        founded: 2020,
        headcount: 10,
        industry: [],
        status: 'Private',
        stage: 'Seed',
        totalRaisedUsd: 0n,
        moderationStatus: 'APPROVED',
        ...data,
      },
    });
    companies.push(row.id);
    return row;
  };
  const round = async (
    companyId: string,
    data: Partial<Prisma.FundingRoundUncheckedCreateInput> = {},
  ) =>
    prisma.fundingRound.create({
      data: {
        companyId,
        name: 'Series A',
        date: new Date('2015-01-01'),
        amountUsd: 1000000n,
        kind: 'Equity',
        moderationStatus: 'APPROVED',
        ...data,
      },
    });
  return {
    app,
    prisma,
    prefix,
    user,
    company,
    round,
    users,
    companies,
    investors,
    async close() {
      if (users.length)
        await prisma.user.deleteMany({ where: { id: { in: users } } });
      if (companies.length)
        await prisma.company.deleteMany({ where: { id: { in: companies } } });
      if (investors.length)
        await prisma.investor.deleteMany({ where: { id: { in: investors } } });
      await app.close();
    },
  };
}
