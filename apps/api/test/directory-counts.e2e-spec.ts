import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { normalizePersonName } from '@repo/api';
import { refreshDirectoryCounts } from '@repo/db';

import { AppModule } from './../src/app.module';
import { AdminService } from './../src/admin/admin.service';
import { MergeService } from './../src/admin/merge/merge.service';
import { InvestorsService } from './../src/investors/investors.service';
import { PrismaService } from './../src/prisma/prisma.service';

// The stored /people and /investors sort keys (Person.roleCount / companyCount,
// Investor.holdingCount), end to end against Postgres: the refresh SQL that a
// mocked Prisma can't run, the list reads that sort on it, and the admin
// decisions that keep it current. Requires Postgres running; seeds and removes
// its own rows. The full (unscoped) refresh walks every person, so on a full
// dataset it takes seconds.
const FULL_REFRESH_TIMEOUT_MS = 120_000;

describe('Directory sort counts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const s = (name: string) => `e2e-dc-${name}-${stamp}`;
  const personName = (name: string) => `E2E Counts ${name} ${stamp}`;

  const companyIds: string[] = [];
  const investorIds: string[] = [];
  const personIds: string[] = [];
  let adminId: string | undefined;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    adminId = (
      await prisma.user.create({
        data: {
          email: `e2e-dc-${stamp}@test.dev`,
          name: 'Directory counts e2e',
          passwordHash: 'unused',
          role: 'ADMIN',
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

    const company = async (name: string, extra: { moderationStatus?: 'APPROVED' | 'PENDING'; mergedIntoId?: string } = {}) => {
      const row = await prisma.company.create({
        data: {
          slug: s(name),
          name: `E2E ${name} ${stamp}`,
          domain: '',
          oneLiner: '',
          description: '',
          hq: '',
          founded: 0,
          headcount: 0,
          status: 'Private',
          stage: 'Seed',
          totalRaisedUsd: 0n,
          moderationStatus: 'APPROVED',
          ...extra,
        },
        select: { id: true },
      });
      companyIds.push(row.id);
      return row.id;
    };
    ids.pubA = await company('pub-a');
    ids.pubB = await company('pub-b');
    ids.pubC = await company('pub-c');
    ids.merged = await company('merged', { mergedIntoId: ids.pubA });
    ids.pendingCo = await company('pending-co', { moderationStatus: 'PENDING' });

    const investor = async (name: string) => {
      const row = await prisma.investor.create({
        data: { slug: s(name), name: `E2E ${name} ${stamp}`, type: 'Venture', moderationStatus: 'APPROVED' },
        select: { id: true },
      });
      investorIds.push(row.id);
      return row.id;
    };
    ids.firm = await investor('firm');
    ids.bigFirm = await investor('big-firm');

    const person = async (name: string) => {
      const row = await prisma.person.create({
        data: {
          slug: s(name),
          name: personName(name),
          normalizedName: normalizePersonName(personName(name)),
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      });
      personIds.push(row.id);
      return row.id;
    };
    const role = async (
      personId: string,
      data: { companyId?: string; investorId?: string; moderationStatus?: 'APPROVED' | 'PENDING' },
      name: string,
    ) =>
      (
        await prisma.personRole.create({
          data: { personId, name, role: 'Director', since: 2020, moderationStatus: 'APPROVED', ...data },
          select: { id: true },
        })
      ).id;

    // P: what counts — two roles at pubA (one company), one at pubB, one
    // company-less firm role. What doesn't — a merged company, a pending role, a
    // pending company. roleCount 4, companyCount 2.
    ids.p = await person('p');
    const p = personName('p');
    await role(ids.p, { companyId: ids.pubA }, p);
    await role(ids.p, { companyId: ids.pubA }, p);
    await role(ids.p, { companyId: ids.pubB }, p);
    await role(ids.p, { investorId: ids.firm }, p);
    await role(ids.p, { companyId: ids.merged }, p);
    await role(ids.p, { companyId: ids.pendingCo }, p);
    // A contributed role on pubA, unattached until approval resolves it by name.
    ids.pendingRole = (
      await prisma.personRole.create({
        data: { name: p, role: 'Director', since: 2020, companyId: ids.pubA, moderationStatus: 'PENDING' },
        select: { id: true },
      })
    ).id;
    // Q: one role at pubB. R: one role at pubC, nowhere near pubB.
    ids.q = await person('q');
    await role(ids.q, { companyId: ids.pubB }, personName('q'));
    ids.r = await person('r');
    await role(ids.r, { companyId: ids.pubC }, personName('r'));

    const holding = (investorId: string, companyId: string, moderationStatus: 'APPROVED' | 'PENDING' = 'APPROVED') =>
      prisma.investorHolding.create({
        data: { investorId, companyId, name: 'E2E holding', type: 'Venture', firstRound: 'Seed', rounds: 1, moderationStatus },
      });
    // firm: one public holding; one on a merged company, one pending, one on a
    // pending company don't count. bigFirm: two.
    await holding(ids.firm, ids.pubA);
    await holding(ids.firm, ids.merged);
    await holding(ids.firm, ids.pubB, 'PENDING');
    await holding(ids.firm, ids.pendingCo);
    await holding(ids.bigFirm, ids.pubA);
    await holding(ids.bigFirm, ids.pubB);
  });

  afterAll(async () => {
    // By the ids this suite created only — see the e2e cleanup rule in CLAUDE.md.
    if (adminId) await prisma.mergeRecord.deleteMany({ where: { mergedById: adminId } });
    await prisma.revision.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.personRole.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.personRole.deleteMany({ where: { investorId: { in: investorIds } } });
    await prisma.investorHolding.deleteMany({ where: { investorId: { in: investorIds } } });
    await prisma.person.deleteMany({ where: { id: { in: personIds } } });
    await prisma.investor.deleteMany({ where: { id: { in: investorIds } } });
    await prisma.company.updateMany({ where: { id: { in: companyIds } }, data: { mergedIntoId: null } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    if (adminId) await prisma.user.delete({ where: { id: adminId } });
    await app.close();
  });

  const stored = async () => {
    const people = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: { id: true, roleCount: true, companyCount: true },
    });
    const firms = await prisma.investor.findMany({ where: { id: { in: investorIds } }, select: { id: true, holdingCount: true } });
    return {
      person: Object.fromEntries(people.map((r) => [r.id, { roles: r.roleCount, companies: r.companyCount }])),
      firm: Object.fromEntries(firms.map((r) => [r.id, r.holdingCount])),
    };
  };
  /** A scope naming exactly this suite's people and firms. */
  const mine = () => ({ personIds, investorIds });

  it(
    'the full refresh stores the public definition',
    async () => {
      await refreshDirectoryCounts(prisma);
      const { person, firm } = await stored();
      expect(person[ids.p!]).toEqual({ roles: 4, companies: 2 });
      expect(person[ids.q!]).toEqual({ roles: 1, companies: 1 });
      expect(person[ids.r!]).toEqual({ roles: 1, companies: 1 });
      expect(firm[ids.firm!]).toBe(1);
      expect(firm[ids.bigFirm!]).toBe(2);
    },
    FULL_REFRESH_TIMEOUT_MS,
  );

  it('a second pass over the same rows writes nothing', async () => {
    // Scoped to this suite's rows: suites run in parallel, so a full pass could
    // legitimately pick up someone else's new rows.
    expect(await refreshDirectoryCounts(prisma, mine())).toEqual({ people: 0, investors: 0 });
  });

  it('a companyIds scope recomputes only the people and firms on those companies', async () => {
    await prisma.person.updateMany({ where: { id: { in: personIds } }, data: { roleCount: 99 } });
    await prisma.investor.updateMany({ where: { id: { in: investorIds } }, data: { holdingCount: 99 } });

    // pubB: P and Q hold roles there, bigFirm a holding (firm's is pending, but
    // it is still attached, so it is recomputed too).
    expect(await refreshDirectoryCounts(prisma, { companyIds: [ids.pubB!] })).toEqual({ people: 2, investors: 2 });
    const { person, firm } = await stored();
    expect(person[ids.p!]!.roles).toBe(4);
    expect(person[ids.q!]!.roles).toBe(1);
    expect(person[ids.r!]!.roles).toBe(99);
    expect(firm[ids.bigFirm!]).toBe(2);

    await refreshDirectoryCounts(prisma, mine());
    expect((await stored()).person[ids.r!]!.roles).toBe(1);
  });

  it('GET /people sorts on the count, and the card count equals the stored one', async () => {
    const res = await request(app.getHttpServer()).get(`/people?q=${stamp}`).expect(200);
    const items = res.body.items as { slug: string; roleCount: number; companyCount: number }[];
    expect(items.map((i) => i.slug)).toEqual([s('p'), s('q'), s('r')]);
    expect(items[0]).toMatchObject({ roleCount: 4, companyCount: 2 });

    const multi = await request(app.getHttpServer()).get(`/people?q=${stamp}&multiCompany=true`).expect(200);
    expect(multi.body).toMatchObject({ total: 1, items: [{ slug: s('p') }] });
  });

  it('GET /investors sorts on the count, and the card count equals the stored one', async () => {
    const res = await request(app.getHttpServer()).get(`/investors?q=${stamp}`).expect(200);
    const items = res.body.items as { slug: string; portfolioCount: number }[];
    expect(items.map((i) => [i.slug, i.portfolioCount])).toEqual([
      [s('big-firm'), 2],
      [s('firm'), 1],
    ]);
  });

  it('approving a contributed role raises its person’s count at once', async () => {
    await app.get(AdminService).moderate('person', ids.pendingRole!, 'APPROVED', adminId!);
    // resolvePerson attached it to P by name.
    const role = await prisma.personRole.findUniqueOrThrow({ where: { id: ids.pendingRole! } });
    expect(role.personId).toBe(ids.p);
    expect((await stored()).person[ids.p!]).toEqual({ roles: 5, companies: 2 });

    // …and rejecting it again lowers it.
    await app.get(AdminService).moderate('person', ids.pendingRole!, 'REJECTED', adminId!);
    expect((await stored()).person[ids.p!]).toEqual({ roles: 4, companies: 2 });
  });

  it('approving a company counts the roles and holdings already on it', async () => {
    await app.get(AdminService).moderate('company', ids.pendingCo!, 'APPROVED', adminId!);
    const { person, firm } = await stored();
    expect(person[ids.p!]).toEqual({ roles: 5, companies: 3 });
    expect(firm[ids.firm!]).toBe(2);
  });

  it('a person merge and its unmerge leave both counts right', async () => {
    const merges = app.get(MergeService);
    const { mergeRecordId } = await merges.merge('person', ids.p!, ids.q!, adminId!);
    let { person } = await stored();
    // Q's pubB role joins P's: one more role, no new company.
    expect(person[ids.p!]).toEqual({ roles: 6, companies: 3 });
    expect(person[ids.q!]).toEqual({ roles: 0, companies: 0 });

    await merges.unmerge(mergeRecordId, adminId!);
    ({ person } = await stored());
    expect(person[ids.p!]).toEqual({ roles: 5, companies: 3 });
    expect(person[ids.q!]).toEqual({ roles: 1, companies: 1 });
  });

  it('a company merge and its unmerge move the counts of everyone on either company', async () => {
    const merges = app.get(MergeService);
    // pubC into pubB: R's role moves onto pubB.
    const { mergeRecordId } = await merges.merge('company', ids.pubB!, ids.pubC!, adminId!);
    expect((await stored()).person[ids.r!]).toEqual({ roles: 1, companies: 1 });

    // The unmerge leaves everyone as they were.
    await merges.unmerge(mergeRecordId, adminId!);
    const { person, firm } = await stored();
    expect(person[ids.r!]).toEqual({ roles: 1, companies: 1 });
    expect(person[ids.p!]).toEqual({ roles: 5, companies: 3 });
    expect(firm[ids.bigFirm!]).toBe(2);
  });

  it('merging a company a person also holds a role at collapses their company count', async () => {
    const merges = app.get(MergeService);
    const { mergeRecordId } = await merges.merge('company', ids.pubA!, ids.pubB!, adminId!);
    let { person, firm } = await stored();
    // P: pubA ×2 + pubB (now pubA) + pendingCo + firm role = 5 roles, 2 companies.
    expect(person[ids.p!]).toEqual({ roles: 5, companies: 2 });
    // bigFirm's two holdings both sit on pubA now; still two rows.
    expect(firm[ids.bigFirm!]).toBe(2);

    await merges.unmerge(mergeRecordId, adminId!);
    ({ person, firm } = await stored());
    expect(person[ids.p!]).toEqual({ roles: 5, companies: 3 });
    expect(firm[ids.bigFirm!]).toBe(2);
  });

  // The /investors card sample is one LATERAL … LIMIT query: run its real SQL.
  it('GET /investors samples six holdings per firm, with partner rows and fields hidden signed out', async () => {
    const firmId = (
      await prisma.investor.create({
        data: { slug: s('sample-firm'), name: `E2E sample-firm ${stamp}`, type: 'Venture', moderationStatus: 'APPROVED' },
        select: { id: true },
      })
    ).id;
    investorIds.push(firmId);
    const sampleCompany = async (name: string, data: { domain: string; primarySector: string; partnerFields?: string[] }) => {
      const row = await prisma.company.create({
        data: {
          slug: s(name),
          name: `E2E ${name} ${stamp}`,
          oneLiner: '',
          description: '',
          hq: '',
          founded: 0,
          headcount: 0,
          status: 'Private',
          stage: 'Seed',
          totalRaisedUsd: 0n,
          moderationStatus: 'APPROVED',
          ...data,
        },
        select: { id: true },
      });
      companyIds.push(row.id);
      return row.id;
    };
    const holding = (companyId: string, externalSource: string, n: number) =>
      prisma.investorHolding.create({
        data: {
          investorId: firmId,
          companyId,
          name: 'E2E holding',
          type: 'Venture',
          firstRound: 'Seed',
          rounds: 1,
          moderationStatus: 'APPROVED',
          externalSource,
          externalId: `e2e-dc-${stamp}-${n}`,
        },
      });

    // Seven WIKIDATA holdings; one SEC_S1 holding on a company whose domain and
    // sector the partner wrote (sorts before WIKIDATA, so always sampled); one
    // PARTNER holding (sorts first, so sampled whenever it is visible).
    for (let n = 0; n < 7; n++) {
      await holding(await sampleCompany(`sample-${n}`, { domain: `e2e-sample-${n}-${stamp}.test`, primarySector: 'Education' }), 'WIKIDATA', n);
    }
    const marked = await sampleCompany('sample-marked', {
      domain: `e2e-marked-${stamp}.test`,
      primarySector: 'Climate',
      partnerFields: ['primarySector', 'domain'],
    });
    await holding(marked, 'SEC_S1', 7);
    await holding(await sampleCompany('sample-partner', { domain: `e2e-partner-${stamp}.test`, primarySector: 'Energy' }), 'PARTNER', 8);
    await refreshDirectoryCounts(prisma, { investorIds: [firmId] });

    type Card = { slug: string; portfolioCount: number; sectors: string[]; companies: { slug: string; domain: string }[] };
    const res = await request(app.getHttpServer()).get(`/investors?q=sample-firm ${stamp}`).expect(200);
    const out = (res.body.items as Card[]).find((i) => i.slug === s('sample-firm'))!;
    // The LIMIT holds per firm, not per page; the count is public, partner rows included.
    expect(out.portfolioCount).toBe(9);
    expect(out.companies).toHaveLength(6);
    expect(out.companies.map((c) => c.slug)).not.toContain(s('sample-partner'));
    expect(out.companies.find((c) => c.slug === s('sample-marked'))).toMatchObject({ domain: '' });
    expect(out.sectors).toEqual(['Education']);

    const signedIn = await app.get(InvestorsService).findAll({ q: `sample-firm ${stamp}` }, { id: adminId!, role: 'ADMIN' });
    const card = signedIn.items.find((i) => i.slug === s('sample-firm'))!;
    expect(card.portfolioCount).toBe(9);
    expect(card.companies).toHaveLength(6);
    expect(card.companies.map((c) => c.slug)).toContain(s('sample-partner'));
    expect(card.companies.find((c) => c.slug === s('sample-marked'))).toMatchObject({ domain: `e2e-marked-${stamp}.test` });
    expect(card.sectors).toEqual(['Climate', 'Education', 'Energy']);
  });
});
