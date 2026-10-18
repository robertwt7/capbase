import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { PeopleService } from './../src/people/people.service';
import { PrismaService } from './../src/prisma/prisma.service';

// PersonContact is PRIVATE: professional contact details licensed from a data
// partner, stored and never published. This seeds a person whose contact row
// holds sentinel values, fetches every public read that can reach that person
// — site API and /v1 — and asserts no response carries any sentinel. It also
// checks that suppressing the person deletes the rows, and that the public
// timeline never shows a raw ingest tag. Requires Postgres running and
// migrated; seeds and removes its own rows.
//
// It deliberately makes no /auth calls (the key's owner is created directly,
// the key minted through the service): the auth routes are throttled at
// 20/min, and the full e2e run already spends most of that budget. Cleanup
// only ever deletes by ids this suite created — a `where: { id: undefined }`
// is NO filter in Prisma and would delete every row.
/** The sitemap reads walk every indexable row; on a full dataset (half a million people
 *  after a partner snapshot) one takes seconds, and these tests make several. */
const SITEMAP_TIMEOUT_MS = 60_000;

describe('Contact privacy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const tag = `e2e-privacy-${stamp}`;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const SENTINELS = [`sentinel-${stamp}@example.test`, '+00 0000 0000', `linkedin.com/in/sentinel-${stamp}`];
  const name = `Privacy Sentinel ${stamp}`;

  let companyId: string | undefined;
  let investorId: string | undefined;
  let personId: string | undefined;
  let key: string;
  let userId: string | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    companyId = (
      await prisma.company.create({
        data: {
          slug: `${tag}-co`,
          name: `E2E Privacy Co ${stamp}`,
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
        },
        select: { id: true },
      })
    ).id;
    investorId = (
      await prisma.investor.create({
        data: { slug: `${tag}-firm`, name: `E2E Privacy Firm ${stamp}`, type: 'Pension fund', moderationStatus: 'APPROVED' },
        select: { id: true },
      })
    ).id;
    personId = (
      await prisma.person.create({
        data: { slug: `${tag}-person`, name, normalizedName: name.toLowerCase(), moderationStatus: 'APPROVED' },
        select: { id: true },
      })
    ).id;
    for (const owner of [{ companyId: companyId! }, { investorId: investorId! }]) {
      const role = await prisma.personRole.create({
        data: {
          ...owner,
          personId,
          name,
          role: 'Managing Partner',
          title: 'Managing Partner',
          since: 2026,
          externalSource: 'PARTNER',
          externalId: `${tag}:${Object.keys(owner)[0]}`,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      });
      await prisma.personContact.create({
        data: {
          personId,
          roleId: role.id,
          email: SENTINELS[0],
          phone: SENTINELS[1],
          linkedinUrl: `https://www.${SENTINELS[2]}`,
          externalSource: 'PARTNER',
          externalId: `${tag}:${Object.keys(owner)[0]}`,
        },
      });
    }
    // Two ingest revisions: one from the partner, one from a tag no table lists.
    await prisma.revision.createMany({
      data: [
        { companyId: companyId!, entityType: 'company', entityId: companyId!, field: 'hq', before: '', after: 'Boston', action: 'UPDATE', actor: 'INGEST', actorSource: 'PARTNER' },
        { companyId: companyId!, entityType: 'company', entityId: companyId!, field: 'domain', before: '', after: 'x.test', action: 'UPDATE', actor: 'INGEST', actorSource: 'SOME_INTERNAL_TAG' },
      ],
    });

    const owner = await prisma.user.create({
      data: {
        email: `${tag}@test.dev`,
        name: 'Privacy e2e',
        passwordHash: 'unused',
        role: 'CONTRIBUTOR',
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    userId = owner.id;
    key = (
      await app
        .get(ApiKeysService)
        .create({ id: owner.id, role: 'CONTRIBUTOR', emailVerified: true }, { name: tag, scope: 'contributor' })
    ).token;
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }); // keys cascade
    if (personId) {
      await prisma.personContact.deleteMany({ where: { personId } });
      await prisma.personRole.deleteMany({ where: { personId } });
      await prisma.person.delete({ where: { id: personId } });
    }
    if (investorId) await prisma.investor.delete({ where: { id: investorId } });
    if (companyId) await prisma.company.delete({ where: { id: companyId } }); // revisions cascade
    await app.close();
  });

  const assertClean = (path: string, body: unknown) => {
    const text = JSON.stringify(body);
    for (const s of SENTINELS) {
      expect({ path, leaked: text.includes(s) }).toEqual({ path, leaked: false });
    }
    expect({ path, leaked: /personContact|"contacts?"/i.test(text) }).toEqual({ path, leaked: false });
  };

  it('no site read carries a stored contact value', async () => {
    const q = encodeURIComponent(name);
    const paths = [
      `/people/${tag}-person`,
      `/investors/${tag}-firm`,
      `/companies/${tag}-co`,
      `/companies/${tag}-co/history`,
      `/search?q=${q}`,
      `/people?q=${q}`,
      '/people/sitemap',
      '/investors/sitemap',
    ];
    for (const path of paths) {
      const res = await http().get(path).expect(200);
      assertClean(path, res.body);
    }
    // The fixture really is reachable — the checks above read the person.
    const person = await http().get(`/people/${tag}-person`).expect(200);
    expect(JSON.stringify(person.body)).toContain(name);
  }, SITEMAP_TIMEOUT_MS);

  it('no /v1 read carries a stored contact value', async () => {
    const q = encodeURIComponent(name);
    for (const path of [
      `/v1/people/${tag}-person`,
      `/v1/investors/${tag}-firm`,
      `/v1/companies/${tag}-co`,
      `/v1/search?q=${q}`,
      `/v1/people?q=${q}`,
    ]) {
      const res = await http().get(path).set(bearer(key)).expect(200);
      assertClean(path, res.body);
    }
  });

  it('the timeline names partner data generically and never leaks a raw tag', async () => {
    // Signed out, neither entry is shown at all (the history allowlist).
    const anon = await http().get(`/companies/${tag}-co/history`).expect(200);
    expect(anon.body.items).toEqual([]);
    // An unlocked viewer sees both — and still no raw tag.
    const jwt = app.get(JwtService).sign({ sub: userId, email: `${tag}@test.dev`, role: 'CONTRIBUTOR', tv: 0 });
    const res = await http().get(`/companies/${tag}-co/history`).set(bearer(jwt)).expect(200);
    const names = (res.body.items as { field: string; actorName: string }[])
      .map((i) => [i.field, i.actorName])
      .sort();
    expect(names).toEqual([
      ['domain', 'automated'],
      ['hq', 'partner'],
    ]);
    expect(JSON.stringify(res.body)).not.toContain('SOME_INTERNAL_TAG');
    expect(JSON.stringify(res.body)).not.toContain('PARTNER');
  });

  it('suppressing the person deletes their stored contact details', async () => {
    expect(await prisma.personContact.count({ where: { personId: personId! } })).toBe(2);
    // The service behind POST /admin/people/:id/suppress (admin-gated).
    await app.get(PeopleService).setSuppressed(personId!, true);
    expect(await prisma.personContact.count({ where: { personId: personId! } })).toBe(0);
    // And the profile is gone.
    await http().get(`/people/${tag}-person`).expect(404);
  });
});
