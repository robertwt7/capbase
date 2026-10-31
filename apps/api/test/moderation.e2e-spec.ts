import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { MODERATION_NOTE_MAX } from '@repo/api';
import request from 'supertest';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Exercises the crowdsource -> moderation cycle end to end against the seeded DB.
// Requires Postgres running (docker compose up) and the DB seeded.
describe('Submissions & moderation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;
  let adminToken: string;
  const email = `e2e-${Date.now()}@test.dev`;
  const roundName = `E2E Round ${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a contributor and an admin can log in', async () => {
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, name: 'E2E User', password: 'password123' })
      .expect(201);
    expect(reg.body.user.role).toBe('USER');
    userToken = reg.body.accessToken;
    // Pre-verified: this suite tests moderation, not email verification.
    await prisma.user.update({
      where: { id: reg.body.user.id },
      data: { emailVerifiedAt: new Date() },
    });

    // The seeded admin credentials come from env (see packages/db/prisma/seed.ts),
    // loaded into process.env by ConfigModule during app.init().
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL ?? 'admin@capbase.fyi',
        password: process.env.ADMIN_PASSWORD ?? 'admin12345',
      })
      .expect(201);
    expect(login.body.user.role).toBe('ADMIN');
    adminToken = login.body.accessToken;
  });

  it('rejects an invalid submission with 400', async () => {
    await request(app.getHttpServer())
      .post('/companies/helia/rounds')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: '', date: 'not-a-date', amountUsd: -1, investors: [] })
      .expect(400);
  });

  it('rejects a contribution without the attestation with 400', async () => {
    const company = {
      name: `E2E Unattested ${Date.now()}`,
      domain: 'unattested.example',
      oneLiner: 'x',
      description: 'x',
      hq: 'Nowhere',
      founded: 2020,
      headcount: 1,
      industry: ['Software'],
      status: 'Private',
      stage: 'Seed',
      totalRaisedUsd: 0,
    };
    const round = {
      name: 'Unattested Round',
      date: '2025-12-01',
      amountUsd: 1_000_000,
      investors: [],
    };
    for (const attested of [undefined, false]) {
      const res = await request(app.getHttpServer())
        .post('/companies')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...company, attested })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('right to share');
      await request(app.getHttpServer())
        .post('/companies/helia/rounds')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ...round, attested })
        .expect(400);
    }
  });

  it('blocks non-admins from the moderation queue with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/submissions')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('hides a pending submission until an admin approves it', async () => {
    // Submit a new round (PENDING).
    const submit = await request(app.getHttpServer())
      .post('/companies/helia/rounds')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: roundName,
        date: '2025-12-01',
        amountUsd: 100_000_000,
        postMoneyUsd: 50_000_000_000,
        lead: 'E2E Capital',
        investors: [{ name: 'E2E Capital', lead: true }],
        attested: true,
      })
      .expect(201);
    expect(submit.body.moderationStatus).toBe('PENDING');
    const roundId = submit.body.id;

    // A pending submission must not unlock the give-to-get gate — otherwise one
    // junk submission buys full access for the whole window.
    const lockedAccess = await request(app.getHttpServer())
      .get('/auth/me/contributions')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(lockedAccess.body.access.unlocked).toBe(false);

    // Not visible yet (still PENDING).
    const before = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(before.body.company.rounds.some((r: { name: string }) => r.name === roundName)).toBe(
      false,
    );

    // Appears in the admin queue.
    const queue = await request(app.getHttpServer())
      .get('/admin/submissions?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.items.some((i: { id: string }) => i.id === roundId)).toBe(true);

    // Approve it.
    await request(app.getHttpServer())
      .patch(`/admin/submissions/round/${roundId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    // Approval unlocks the contributor.
    const unlockedAccess = await request(app.getHttpServer())
      .get('/auth/me/contributions')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(unlockedAccess.body.access.unlocked).toBe(true);

    // Now visible to the (unlocked) contributor.
    const after = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(after.body.company.rounds.some((r: { name: string }) => r.name === roundName)).toBe(
      true,
    );
  });

  it('applies an approved edit proposal to the company', async () => {
    // Read the live values so the proposal is a real diff.
    const before = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const newHq = `E2E City ${Date.now()}`;
    const newHeadcount = before.body.company.headcount + 1;

    // A no-op diff is rejected outright.
    await request(app.getHttpServer())
      .post('/companies/helia/proposals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ changes: { hq: before.body.company.hq }, attested: true })
      .expect(400);

    // Submit a real proposal (PENDING).
    const submit = await request(app.getHttpServer())
      .post('/companies/helia/proposals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        changes: { hq: newHq, headcount: newHeadcount },
        note: 'e2e correction',
        attested: true,
      })
      .expect(201);
    expect(submit.body.moderationStatus).toBe('PENDING');
    const proposalId = submit.body.id;

    // The queue carries the diff plus the company's current values.
    const queue = await request(app.getHttpServer())
      .get('/admin/submissions?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const item = queue.body.items.find((i: { id: string }) => i.id === proposalId);
    expect(item.type).toBe('proposal');
    expect(item.data.changes).toEqual({ hq: newHq, headcount: newHeadcount });
    expect(item.data.current.hq).toBe(before.body.company.hq);
    expect(item.data.note).toBe('e2e correction');
    expect(queue.body.countsByType.proposal).toBeGreaterThanOrEqual(1);

    // Approve — the company row is updated in the same stroke.
    await request(app.getHttpServer())
      .patch(`/admin/submissions/proposal/${proposalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(after.body.company.hq).toBe(newHq);
    expect(after.body.company.headcount).toBe(newHeadcount);
  });

  it('leaves the company untouched when a proposal is rejected', async () => {
    const before = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const submit = await request(app.getHttpServer())
      .post('/companies/helia/proposals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ changes: { oneLiner: 'Rejected e2e one-liner' }, attested: true })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/admin/submissions/proposal/${submit.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(after.body.company.oneLiner).toBe(before.body.company.oneLiner);
  });

  it('takes an optional rejection reason, capped in length', async () => {
    const submit = await request(app.getHttpServer())
      .post('/companies/helia/proposals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ changes: { oneLiner: 'Rejected-with-reason e2e one-liner' }, attested: true })
      .expect(201);
    const path = `/admin/submissions/proposal/${submit.body.id}`;

    await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', note: 'x'.repeat(MODERATION_NOTE_MAX + 1) })
      .expect(400);
    expect(
      (await prisma.changeProposal.findUniqueOrThrow({ where: { id: submit.body.id } }))
        .moderationStatus,
    ).toBe('PENDING');

    // Mail is off in e2e (no RESEND_API_KEY) or may fail: either way the
    // decision stands — the contributor email never blocks it.
    const res = await request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', note: 'The source does not mention this.' })
      .expect(200);
    expect(res.body.moderationStatus).toBe('REJECTED');
  });
});

// The queue's filters, the per-user view and retraction. No /auth calls (throttled
// at 20/min across the whole run): users are created with Prisma and their JWTs
// signed with the app's JwtService. Cleanup deletes only ids this suite created,
// each guarded — a `where: { id: undefined }` is NO filter in Prisma.
describe('Moderation queue filters & retraction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const tag = `e2e-queue-${stamp}`;
  const companyName = `Queue Filter Co ${stamp}`;
  const http = () => request(app.getHttpServer());
  const ids: Record<string, string | undefined> = {};
  const tokens: Record<'admin' | 'alice' | 'bob', string> = { admin: '', alice: '', bob: '' };

  const as = (who: keyof typeof tokens) => `Bearer ${tokens[who]}`;
  const queue = (query: string) =>
    http().get(`/admin/submissions?${query}`).set('Authorization', as('admin')).expect(200);
  const decide = (type: string, id: string, status: 'APPROVED' | 'REJECTED') =>
    http()
      .patch(`/admin/submissions/${type}/${id}`)
      .set('Authorization', as('admin'))
      .send({ status })
      .expect(200);
  const itemIds = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
  const pendingRound = (name: string, submittedById: string | undefined, createdAt: Date) =>
    prisma.fundingRound.create({
      data: {
        companyId: ids.company!,
        name,
        date: new Date('2025-01-01'),
        amountUsd: 1_000_000n,
        submittedById,
        createdAt,
      },
      select: { id: true },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const jwt = app.get(JwtService);
    for (const [who, role] of [
      ['admin', 'ADMIN'],
      ['alice', 'USER'],
      ['bob', 'USER'],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          email: `${tag}-${who}@test.dev`,
          name: `Queue ${who}`,
          passwordHash: 'unused',
          role,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, tokenVersion: true },
      });
      ids[who] = user.id;
      tokens[who] = jwt.sign({ sub: user.id, email: user.email, role, tv: user.tokenVersion });
    }

    // An ingested company with an ingested round: auto-approved, no submitter.
    ids.company = (
      await prisma.company.create({
        data: {
          slug: tag,
          name: companyName,
          domain: '',
          oneLiner: '',
          description: '',
          hq: 'Old HQ',
          founded: 2015,
          headcount: 10,
          status: 'Private',
          stage: 'Seed',
          totalRaisedUsd: 0n,
          externalSource: 'SEC_EDGAR',
          externalId: tag,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
    ids.ingested = (
      await prisma.fundingRound.create({
        data: {
          companyId: ids.company,
          name: 'Ingested Seed',
          date: new Date('2024-01-01'),
          amountUsd: 1n,
          externalSource: 'SEC_EDGAR',
          externalId: tag,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
    // Alice submits an older and a newer round; Bob one. Recent, so an approval
    // is inside the access window (anchored on createdAt).
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    ids.older = (await pendingRound('Older round', ids.alice, daysAgo(3))).id;
    ids.newer = (await pendingRound('Newer round', ids.alice, daysAgo(2))).id;
    ids.bobs = (await pendingRound('Bob round', ids.bob, daysAgo(1))).id;
  });

  afterAll(async () => {
    // The company cascades its rounds, proposals and revisions.
    if (ids.company) await prisma.company.delete({ where: { id: ids.company } });
    if (ids.contributed) {
      await prisma.company.deleteMany({ where: { id: ids.contributed } });
    }
    for (const who of ['admin', 'alice', 'bob', 'carol']) {
      const id = ids[who];
      if (id) await prisma.user.delete({ where: { id } });
    }
    await app.close();
  });

  it('sorts approved contributions by decision time and names the moderator', async () => {
    // The newer submission is approved first, the older one last: the older one
    // tops the Approved tab.
    await decide('round', ids.newer!, 'APPROVED');
    await decide('round', ids.older!, 'APPROVED');

    const res = await queue(`status=APPROVED&source=contributed&q=${encodeURIComponent(companyName)}`);
    expect(itemIds(res)).toEqual([ids.older, ids.newer]);
    expect(res.body.items[0]).toMatchObject({
      reviewedBy: { id: ids.admin, name: 'Queue admin' },
      companyName,
    });
    expect(Date.parse(res.body.items[0].reviewedAt)).toBeGreaterThan(
      Date.parse(res.body.items[1].reviewedAt),
    );
    expect(res.body.countsByType.round).toBe(2);
  });

  it('separates contributed from ingested rows', async () => {
    const q = `q=${encodeURIComponent(companyName)}`;
    const contributed = itemIds(await queue(`status=APPROVED&source=contributed&${q}`));
    expect(contributed).not.toContain(ids.ingested);

    const ingested = await queue(`status=APPROVED&source=ingested&${q}`);
    // The company row and its round, both ingested; no contribution.
    expect(itemIds(ingested).sort()).toEqual([ids.company, ids.ingested].sort());
    expect(ingested.body.items.every((i: { reviewedAt: unknown }) => i.reviewedAt === null)).toBe(true);

    // No source: everything, as /v1 has always listed it.
    expect(itemIds(await queue(`status=APPROVED&${q}`))).toEqual(
      expect.arrayContaining([ids.company, ids.ingested, ids.older, ids.newer]),
    );
  });

  it("narrows to one contributor's rows in each status", async () => {
    await decide('round', ids.bobs!, 'REJECTED');
    expect(itemIds(await queue(`status=REJECTED&user=${ids.bob}`))).toEqual([ids.bobs]);
    expect(itemIds(await queue(`status=APPROVED&user=${ids.bob}`))).toEqual([]);
    expect(itemIds(await queue(`status=APPROVED&user=${ids.alice}`))).toEqual([ids.older, ids.newer]);
    expect(itemIds(await queue('status=APPROVED&user=nobody'))).toEqual([]);
  });

  it('validates the new params', async () => {
    await http()
      .get('/admin/submissions?source=bogus')
      .set('Authorization', as('admin'))
      .expect(400);
    await http()
      .get(`/admin/submissions?q=${'x'.repeat(101)}`)
      .set('Authorization', as('admin'))
      .expect(400);
    // Under the minimum is ignored, not an error.
    await queue('q=x');
  });

  it('keeps /v1/submissions listing ingested rows', async () => {
    const key = (
      await app.get(ApiKeysService).create(
        { id: ids.admin!, role: 'ADMIN', emailVerified: true },
        { name: tag, scope: 'admin' },
      )
    ).token;
    const all: string[] = [];
    let before: string | null = null;
    // The newest rows: this suite's ingested ones were created moments ago.
    for (let page = 0; page < 3 && !all.includes(ids.ingested!); page++) {
      const res = await http()
        .get(`/v1/submissions?status=APPROVED${before ? `&before=${encodeURIComponent(before)}` : ''}`)
        .set('Authorization', `Bearer ${key}`)
        .expect(200);
      all.push(...itemIds(res));
      before = res.body.nextCursor;
      if (!before) break;
    }
    expect(all).toContain(ids.ingested);
  });

  it("reports a user's access, which follows their approved rows", async () => {
    const detail = async () =>
      (await http().get(`/admin/users/${ids.alice}`).set('Authorization', as('admin')).expect(200))
        .body;
    expect(await detail()).toMatchObject({
      id: ids.alice,
      approvedCount: 2,
      contributions: { PENDING: 0, APPROVED: 2, REJECTED: 0 },
      access: { unlocked: true, signedIn: true },
    });

    await decide('round', ids.older!, 'REJECTED');
    await decide('round', ids.newer!, 'REJECTED');
    expect(await detail()).toMatchObject({
      contributions: { PENDING: 0, APPROVED: 0, REJECTED: 2 },
      access: { unlocked: false, unlockedUntil: null },
    });

    await http().get(`/admin/users/${ids.alice}`).set('Authorization', as('bob')).expect(403);
    await http().get('/admin/users/nobody').set('Authorization', as('admin')).expect(404);
  });

  it('records a retracted round on the timeline', async () => {
    const history = await http()
      .get(`/companies/${tag}/history?pageSize=50`)
      .set('Authorization', as('admin'))
      .expect(200);
    const retracts = history.body.items.filter(
      (r: { action: string; entityId: string }) => r.action === 'RETRACT' && r.entityId === ids.older,
    );
    expect(retracts).toHaveLength(1);
    expect(retracts[0]).toMatchObject({ field: '', actorName: 'Queue admin' });
    // The retracted round is gone from the profile.
    const profile = await http().get(`/companies/${tag}`).set('Authorization', as('admin')).expect(200);
    expect(profile.body.company.rounds.map((r: { id: string }) => r.id)).not.toContain(ids.older);
  });

  it('reverts an approved edit, keeping fields changed since', async () => {
    const proposal = await prisma.changeProposal.create({
      data: {
        companyId: ids.company!,
        changes: { hq: 'New HQ', headcount: 20 },
        submittedById: ids.alice,
      },
      select: { id: true },
    });
    await decide('proposal', proposal.id, 'APPROVED');
    const profile = () =>
      http().get(`/companies/${tag}`).set('Authorization', as('admin')).expect(200);
    expect((await profile()).body.company).toMatchObject({ hq: 'New HQ', headcount: 20 });

    // Someone else edits headcount after the approval.
    await prisma.company.update({ where: { id: ids.company }, data: { headcount: 30 } });

    const res = await decide('proposal', proposal.id, 'REJECTED');
    expect(res.body).toMatchObject({ revertedFields: ['hq'], skippedFields: ['headcount'] });
    expect((await profile()).body.company).toMatchObject({ hq: 'Old HQ', headcount: 30 });

    const history = await http()
      .get(`/companies/${tag}/history?pageSize=50`)
      .set('Authorization', as('admin'))
      .expect(200);
    expect(
      history.body.items.filter((r: { action: string }) => r.action === 'RETRACT'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'hq', before: 'New HQ', after: 'Old HQ' }),
      ]),
    );

    // Re-approving applies the diff again.
    await decide('proposal', proposal.id, 'APPROVED');
    expect((await profile()).body.company).toMatchObject({ hq: 'New HQ', headcount: 20 });
  });

  it('unpublishes an approved company when it is rejected', async () => {
    ids.contributed = (
      await prisma.company.create({
        data: {
          slug: `${tag}-contributed`,
          name: `Queue Contributed Co ${stamp}`,
          domain: '',
          oneLiner: '',
          description: '',
          hq: 'Somewhere',
          founded: 2020,
          headcount: 1,
          status: 'Private',
          stage: 'Seed',
          totalRaisedUsd: 0n,
          submittedById: ids.alice,
        },
        select: { id: true },
      })
    ).id;
    await decide('company', ids.contributed, 'APPROVED');
    await http().get(`/companies/${tag}-contributed`).expect(200);
    await decide('company', ids.contributed, 'REJECTED');
    await http().get(`/companies/${tag}-contributed`).expect(404);

    const rejected = await queue(`status=REJECTED&user=${ids.alice}&type=company`);
    expect(itemIds(rejected)).toEqual([ids.contributed]);
    expect(rejected.body.items[0].reviewedBy.name).toBe('Queue admin');
  });

  it("stamps the ban sweep's rejections with the banning admin", async () => {
    const carol = await prisma.user.create({
      data: { email: `${tag}-carol@test.dev`, name: 'Queue carol', passwordHash: 'unused' },
      select: { id: true },
    });
    ids.carol = carol.id;
    const row = await pendingRound('Carol round', carol.id, new Date());
    await http()
      .patch(`/admin/users/${carol.id}`)
      .set('Authorization', as('admin'))
      .send({ banned: true })
      .expect(200);
    const swept = await prisma.fundingRound.findUniqueOrThrow({ where: { id: row.id } });
    expect(swept).toMatchObject({ moderationStatus: 'REJECTED', reviewedById: ids.admin });
    expect(swept.reviewedAt).toBeInstanceOf(Date);
  });
});
