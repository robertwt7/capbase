import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { API_KEY_LIMITS, MAX_V1_LIST_DEPTH } from '@repo/api';
import request from 'supertest';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { setupApiDocs } from './../src/v1/docs';

// The public, key-authenticated API (/v1): key auth, scopes, contributor PENDING vs admin
// publish, the moderation queue over keys, and the per-owner throttle. Requires Postgres running,
// migrated and seeded (the seeded admin and the `helia` demo company).
describe('Public API /v1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const prefix = `e2e-v1-${stamp}`;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  let adminJwt: string;
  let contributorJwt: string;
  let contributorId: string;
  let contributorKey: string;
  let adminKey: string;

  const company = (name: string, domain: string) => ({
    name,
    domain,
    oneLiner: 'A company added through the public API.',
    description: 'Created by the /v1 e2e suite.',
    hq: 'London',
    founded: 2021,
    headcount: 12,
    industry: ['Software'],
    status: 'Private',
    stage: 'Seed',
    totalRaisedUsd: 0,
    attested: true,
  });

  /** Register a verified user with `role`, returning its id and a JWT. */
  async function userWith(role: 'USER' | 'CONTRIBUTOR', tag: string) {
    const email = `${prefix}-${tag}@test.dev`;
    const reg = await http()
      .post('/auth/register')
      .send({ email, name: `V1 ${tag}`, password: 'password123' })
      .expect(201);
    await prisma.user.update({
      where: { id: reg.body.user.id },
      data: { role, emailVerifiedAt: new Date() },
    });
    return {
      id: reg.body.user.id as string,
      jwt: reg.body.accessToken as string,
    };
  }

  const mintKey = (jwt: string, body: Record<string, unknown>) =>
    http().post('/auth/me/api-keys').set(bearer(jwt)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    setupApiDocs(app);
    await app.init();
    prisma = app.get(PrismaService);

    const login = await http()
      .post('/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL ?? 'admin@capbase.fyi',
        password: process.env.ADMIN_PASSWORD ?? 'admin12345',
      })
      .expect(201);
    adminJwt = login.body.accessToken;

    const contributor = await userWith('CONTRIBUTOR', 'contrib');
    contributorId = contributor.id;
    contributorJwt = contributor.jwt;
    contributorKey = (
      await mintKey(contributorJwt, {
        name: 'e2e',
        scope: 'contributor',
      }).expect(201)
    ).body.token;
    adminKey = (
      await mintKey(adminJwt, {
        name: `${prefix} admin`,
        scope: 'admin',
      }).expect(201)
    ).body.token;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: prefix } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await prisma.apiKey.deleteMany({ where: { name: { startsWith: prefix } } });
    const companies = await prisma.company.findMany({
      where: { name: { startsWith: prefix } },
      select: { id: true },
    });
    const companyIds = companies.map((c) => c.id);
    await prisma.citation.deleteMany({
      where: { entityType: 'company', entityId: { in: companyIds } },
    });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.investor.deleteMany({
      where: { slug: { startsWith: prefix } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  describe('key management', () => {
    it('refuses a plain USER, and a contributor asking for an admin key', async () => {
      const user = await userWith('USER', 'plain');
      await mintKey(user.jwt, { name: 'x', scope: 'contributor' }).expect(403);
      await mintKey(contributorJwt, { name: 'x', scope: 'admin' }).expect(403);
    });

    it('stores only the hash, never the token', async () => {
      const row = await prisma.apiKey.findFirstOrThrow({
        where: { userId: contributorId },
        select: { prefix: true, hash: true },
      });
      expect(contributorKey.startsWith(`${row.prefix}_`)).toBe(true);
      expect(row.hash).not.toContain(contributorKey);
      const listed = await http().get('/auth/me/api-keys').set(bearer(contributorJwt)).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(contributorKey);
    });

    it('rejects a bad CIDR with its value in the message', async () => {
      const res = await mintKey(contributorJwt, {
        name: 'x',
        scope: 'contributor',
        allowedCidrs: ['not-an-ip'],
      }).expect(400);
      expect(JSON.stringify(res.body.message)).toContain('not-an-ip');
    });
  });

  describe('authentication', () => {
    it('answers 401 without a key, with a JWT, or with garbage', async () => {
      for (const path of ['/v1/me', '/v1/companies', '/v1/submissions']) {
        await http().get(path).expect(401);
        await http().get(path).set(bearer(contributorJwt)).expect(401);
        await http().get(path).set(bearer('cbk_garbage')).expect(401);
      }
      await http()
        .post('/v1/companies')
        .send(company(`${prefix} x`, 'x.example'))
        .expect(401);
    });

    it('leaves the JWT routes alone, and refuses a key there', async () => {
      await http().get('/auth/me').set(bearer(contributorJwt)).expect(200);
      await http().get('/auth/me').set(bearer(contributorKey)).expect(401);
      await http().get('/companies?pageSize=1').expect(200);
    });

    it('identifies the key on /v1/me', async () => {
      const res = await http().get('/v1/me').set(bearer(contributorKey)).expect(200);
      expect(res.body).toMatchObject({
        user: { id: contributorId, role: 'CONTRIBUTOR' },
        key: { scope: 'contributor' },
        pending: 0,
        pendingCap: 500,
      });
    });

    it('answers 403 from outside the allowlist', async () => {
      const pinned = await mintKey(contributorJwt, {
        name: 'pinned',
        scope: 'contributor',
        allowedCidrs: ['10.9.9.9/32'],
      }).expect(201);
      await http().get('/v1/me').set(bearer(pinned.body.token)).expect(403);
      await http()
        .delete(`/auth/me/api-keys/${pinned.body.key.id}`)
        .set(bearer(contributorJwt))
        .expect(204);
    });

    it('answers 401 for a revoked key', async () => {
      const spare = await mintKey(contributorJwt, {
        name: 'spare',
        scope: 'contributor',
      }).expect(201);
      await http().get('/v1/me').set(bearer(spare.body.token)).expect(200);
      await http()
        .delete(`/auth/me/api-keys/${spare.body.key.id}`)
        .set(bearer(contributorJwt))
        .expect(204);
      await http().get('/v1/me').set(bearer(spare.body.token)).expect(401);
    });

    it('answers 401 once the owner is demoted, and the demotion revokes the key', async () => {
      const owner = await userWith('CONTRIBUTOR', 'demoted');
      const key = (await mintKey(owner.jwt, { name: 'd', scope: 'contributor' }).expect(201)).body
        .token;
      await http().get('/v1/me').set(bearer(key)).expect(200);
      // The role alone is enough: a key is re-checked against the owner's row every time.
      await prisma.user.update({
        where: { id: owner.id },
        data: { role: 'USER' },
      });
      await http().get('/v1/me').set(bearer(key)).expect(401);
      // Through the admin route, the key is also revoked (gone from the owner's list).
      await prisma.user.update({
        where: { id: owner.id },
        data: { role: 'CONTRIBUTOR' },
      });
      await http().get('/v1/me').set(bearer(key)).expect(200);
      await http()
        .patch(`/admin/users/${owner.id}`)
        .set(bearer(adminJwt))
        .send({ role: 'USER' })
        .expect(200);
      await http().get('/v1/me').set(bearer(key)).expect(401);
      const keys = await prisma.apiKey.count({
        where: { userId: owner.id, revokedAt: null },
      });
      expect(keys).toBe(0);
    });
  });

  describe('writes', () => {
    let pendingId: string;
    const pendingName = `${prefix} Pending Co`;

    it('requires the attestation', async () => {
      const unattested = {
        ...company(`${prefix} Unattested`, 'u.example'),
        attested: undefined,
      };
      await http().post('/v1/companies').set(bearer(contributorKey)).send(unattested).expect(400);
    });

    it('lands a contributor write PENDING, attributed to the owner', async () => {
      const res = await http()
        .post('/v1/companies')
        .set(bearer(contributorKey))
        .send(company(pendingName, `pending-${stamp}.example`))
        .expect(201);
      expect(res.body.moderationStatus).toBe('PENDING');
      pendingId = res.body.id;
      const row = await prisma.company.findUniqueOrThrow({
        where: { id: pendingId },
      });
      expect(row.submittedById).toBe(contributorId);

      const queue = await http()
        .get('/admin/submissions?type=company')
        .set(bearer(adminJwt))
        .expect(200);
      expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(pendingId);

      const listed = await http()
        .get(`/v1/companies?domain=pending-${stamp}.example`)
        .set(bearer(contributorKey))
        .expect(200);
      expect(listed.body.total).toBe(0);
    });

    it('keeps the moderation queue to admin keys', async () => {
      await http().get('/v1/submissions').set(bearer(contributorKey)).expect(403);
      await http()
        .post(`/v1/submissions/company/${pendingId}/approve`)
        .set(bearer(contributorKey))
        .expect(403);
    });

    it('lets an admin key approve a pending row, which then goes public', async () => {
      const queue = await http()
        .get('/v1/submissions?type=company')
        .set(bearer(adminKey))
        .expect(200);
      expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(pendingId);
      await http()
        .post(`/v1/submissions/company/${pendingId}/approve`)
        .set(bearer(adminKey))
        .expect(200);
      const listed = await http()
        .get(`/v1/companies?domain=pending-${stamp}.example`)
        .set(bearer(contributorKey))
        .expect(200);
      expect(listed.body.items.map((c: { name: string }) => c.name)).toEqual([pendingName]);
    });

    it('lets an admin key reject with a note', async () => {
      const res = await http()
        .post('/v1/companies')
        .set(bearer(contributorKey))
        .send(company(`${prefix} Rejected Co`, `rejected-${stamp}.example`))
        .expect(201);
      await http()
        .post(`/v1/submissions/company/${res.body.id}/reject`)
        .set(bearer(adminKey))
        .send({ note: 'No source.' })
        .expect(200);
      const row = await prisma.company.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.moderationStatus).toBe('REJECTED');
    });

    it('publishes an admin-key write at once, with a CREATE revision', async () => {
      const res = await http()
        .post('/v1/companies')
        .set(bearer(adminKey))
        .send(company(`${prefix} Published Co`, `https://www.Published-${stamp}.example/`))
        .expect(201);
      expect(res.body.moderationStatus).toBe('APPROVED');

      // Stored as the bare host, found by any spelling of it.
      const listed = await http()
        .get(`/v1/companies?domain=published-${stamp}.example`)
        .set(bearer(contributorKey))
        .expect(200);
      expect(listed.body.items.map((c: { slug: string }) => c.slug)).toEqual([res.body.slug]);

      const revision = await prisma.revision.findFirst({
        where: {
          entityType: 'company',
          entityId: res.body.id,
          action: 'CREATE',
        },
      });
      expect(revision?.actor).toBe('ADMIN');

      // A child row on the new company is published the same way.
      const round = await http()
        .post(`/v1/companies/${res.body.slug}/rounds`)
        .set(bearer(adminKey))
        .send({
          name: 'Seed',
          date: '2025-06-01',
          amountUsd: 2_000_000,
          investors: [],
          attested: true,
        })
        .expect(201);
      expect(round.body.moderationStatus).toBe('APPROVED');
      const detail = await http()
        .get(`/v1/companies/${res.body.slug}`)
        .set(bearer(contributorKey))
        .expect(200);
      expect(detail.body.company.rounds.map((r: { id: string }) => r.id)).toContain(round.body.id);
    });
  });

  describe('investor-firm edits', () => {
    it('lands a contributor edit PENDING; an admin key approves it and the firm shows it', async () => {
      const firm = await prisma.investor.create({
        data: {
          slug: `${prefix}-firm`,
          name: `${prefix} Firm Capital`,
          type: 'Venture',
          websiteUrl: 'https://old.example',
          moderationStatus: 'APPROVED',
        },
      });
      const proposed = await http()
        .post(`/v1/investors/${firm.slug}/proposals`)
        .set(bearer(contributorKey))
        .send({
          changes: { websiteUrl: 'https://new.example', name: firm.name },
          sourceUrl: 'https://new.example/about',
          attested: true,
        })
        .expect(201);
      expect(proposed.body.moderationStatus).toBe('PENDING');

      // Nothing changed yet; an identical edit is a 400.
      await http()
        .post(`/v1/investors/${firm.slug}/proposals`)
        .set(bearer(contributorKey))
        .send({
          changes: { websiteUrl: 'https://old.example' },
          attested: true,
        })
        .expect(400);
      const before = await http()
        .get(`/v1/investors/${firm.slug}`)
        .set(bearer(contributorKey))
        .expect(200);
      expect(before.body.websiteUrl).toBe('https://old.example');

      const queue = await http()
        .get('/v1/submissions?type=investorProposal')
        .set(bearer(adminKey))
        .expect(200);
      const card = queue.body.items.find((i: { id: string }) => i.id === proposed.body.id);
      expect(card).toMatchObject({
        investorSlug: firm.slug,
        sourceUrl: 'https://new.example/about',
        data: { changes: { websiteUrl: 'https://new.example' } },
      });

      await http()
        .post(`/v1/submissions/investorProposal/${proposed.body.id}/approve`)
        .set(bearer(adminKey))
        .expect(200);
      const after = await http()
        .get(`/v1/investors/${firm.slug}`)
        .set(bearer(contributorKey))
        .expect(200);
      expect(after.body.websiteUrl).toBe('https://new.example');
      const row = await prisma.investorChangeProposal.findUniqueOrThrow({
        where: { id: proposed.body.id },
      });
      expect(row.previous).toEqual({ websiteUrl: 'https://old.example' });
    });

    it('publishes an admin-key edit at once', async () => {
      const firm = await prisma.investor.create({
        data: {
          slug: `${prefix}-firm2`,
          name: `${prefix} Second Firm`,
          type: 'Venture',
          moderationStatus: 'APPROVED',
        },
      });
      const res = await http()
        .post(`/v1/investors/${firm.slug}/proposals`)
        .set(bearer(adminKey))
        .send({ changes: { hq: 'Lisbon', countryCode: 'PT' }, attested: true })
        .expect(201);
      expect(res.body.moderationStatus).toBe('APPROVED');
      const after = await http()
        .get(`/v1/investors/${firm.slug}`)
        .set(bearer(adminKey))
        .expect(200);
      expect(after.body).toMatchObject({ hq: 'Lisbon', countryCode: 'PT' });
    });

    it('answers 404 for an unknown firm', async () => {
      await http()
        .post(`/v1/investors/${prefix}-nope/proposals`)
        .set(bearer(contributorKey))
        .send({ changes: { hq: 'x' }, attested: true })
        .expect(404);
    });
  });

  describe('reads', () => {
    it('serves the directories and profiles', async () => {
      const key = bearer(contributorKey);
      await http().get('/v1/companies/helia').set(key).expect(200);
      const investors = await http().get('/v1/investors?pageSize=1').set(key).expect(200);
      if (investors.body.items[0]) {
        await http().get(`/v1/investors/${investors.body.items[0].slug}`).set(key).expect(200);
      }
      await http().get('/v1/people?pageSize=1').set(key).expect(200);
      await http().get('/v1/funds?pageSize=1').set(key).expect(200);
      await http().get('/v1/search?q=hel').set(key).expect(200);
      // The directory reads count every public row; on a full dataset that is
      // seconds per read, past Jest's 5s default.
    }, 60_000);
  });

  describe('OpenAPI docs', () => {
    type Schema = {
      properties?: Record<string, unknown>;
      required?: string[];
      $ref?: string;
    };
    type Spec = {
      paths: Record<
        string,
        Record<string, { requestBody?: { content: Record<string, { schema: Schema }> } }>
      >;
      components: { schemas: Record<string, Schema> };
    };

    it('serves the document without a key, covering only /v1', async () => {
      const res = await http().get('/v1/openapi.json').expect(200);
      const spec = res.body as Spec;
      const paths = Object.keys(spec.paths);
      expect(paths.length).toBeGreaterThan(10);
      expect(paths.every((p) => p.startsWith('/v1/'))).toBe(true);
      expect(paths).toEqual(expect.arrayContaining(['/v1/me', '/v1/companies', '/v1/submissions']));
      expect(paths.some((p) => p.startsWith('/admin') || p.startsWith('/auth'))).toBe(false);
      expect(paths).not.toContain('/companies');
    });

    it('describes the request body of POST /v1/companies, attested included', async () => {
      const spec = (await http().get('/v1/openapi.json').expect(200)).body as Spec;
      const body = spec.paths['/v1/companies']?.post?.requestBody;
      const ref = body?.content['application/json']?.schema.$ref ?? '';
      const schema = spec.components.schemas[ref.split('/').pop() ?? ''];
      expect(Object.keys(schema?.properties ?? {})).toEqual(
        expect.arrayContaining(['name', 'domain', 'attested', 'sourceUrl']),
      );
      expect(schema?.required).toEqual(expect.arrayContaining(['name', 'attested']));
    });

    it('documents the depth-cap 400 on every list route', async () => {
      const spec = (await http().get('/v1/openapi.json').expect(200)).body as {
        paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
      };
      for (const path of ['/v1/companies', '/v1/investors', '/v1/people', '/v1/funds']) {
        expect(Object.keys(spec.paths[path]?.get?.responses ?? {})).toContain('400');
      }
    });

    it('serves Swagger UI', async () => {
      const res = await http().get('/v1/docs/').expect(200);
      expect(res.text).toContain('swagger');
    });
  });

  /** A verified contributor made with Prisma (no /auth call), with `keys` keys of its own, so
   *  its throttle buckets are untouched by the rest of the suite. Cleaned up in afterAll by the
   *  suite's email prefix (keys cascade). */
  async function freshContributor(tag: string, keys: number) {
    const user = await prisma.user.create({
      data: {
        email: `${prefix}-${tag}@test.dev`,
        name: `V1 ${tag}`,
        passwordHash: 'unused',
        role: 'CONTRIBUTOR',
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    const tokens: string[] = [];
    for (let i = 0; i < keys; i++) {
      const created = await app
        .get(ApiKeysService)
        .create(
          { id: user.id, role: 'CONTRIBUTOR', emailVerified: true },
          { name: `${prefix} ${tag} ${i}`, scope: 'contributor' },
        );
      tokens.push(created.token);
    }
    return tokens;
  }

  describe('list depth', () => {
    const lists = ['/v1/companies', '/v1/investors', '/v1/people', '/v1/funds'];
    const deepest = MAX_V1_LIST_DEPTH / 100;
    let key: string;
    beforeAll(async () => {
      [key = ''] = await freshContributor('depth', 1);
    });

    it(`serves rows up to ${MAX_V1_LIST_DEPTH} and answers 400 past them`, async () => {
      for (const path of lists) {
        await http().get(`${path}?page=${deepest}&pageSize=100`).set(bearer(key)).expect(200);
        const res = await http()
          .get(`${path}?page=${deepest + 1}&pageSize=100`)
          .set(bearer(key))
          .expect(400);
        expect(JSON.stringify(res.body.message)).toContain('Lists stop at row');
      }
      // The default page size counts too: 401 × 25 is past the cap.
      await http().get('/v1/companies?page=401').set(bearer(key)).expect(400);
      await http().get('/v1/companies?page=400').set(bearer(key)).expect(200);
      // Deep offsets on a full dataset take seconds per read.
    }, 120_000);

    it("leaves the website's directory uncapped", async () => {
      await http().get(`/companies?page=${deepest + 1}&pageSize=100`).expect(200);
    }, 60_000);
  });

  describe('throttle', () => {
    it(`answers 429 on a contributor's write ${API_KEY_LIMITS.contributor.write + 1} in a minute, across keys`, async () => {
      const keys = await freshContributor('burst', 2);
      const codes: number[] = [];
      for (let i = 0; i <= API_KEY_LIMITS.contributor.write; i++) {
        // An empty body: the throttle counts before validation, and nothing is written.
        // Alternating keys: the budget is the owner's, not each key's.
        const key = keys[i % keys.length] ?? '';
        codes.push((await http().post('/v1/companies').set(bearer(key)).send({})).status);
      }
      expect(codes.slice(0, -1).every((c) => c === 400)).toBe(true);
      expect(codes[codes.length - 1]).toBe(429);
    });
  });
});
