import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { ApiKeysService } from '../src/api-keys/api-keys.service';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApiDocs } from '../src/v1/docs';

/** Real database proof of election, freshness, preview and shared /v1 policy. No network crawls. */
describe('Technology details (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let companyId: string;
  let partnerId: string;
  let emptyId: string;
  let sourceId: string;
  let contributorId: string;
  let userId: string;
  let contributorJwt: string;
  let userJwt: string;
  let key: string;
  let scanId: string;
  const tag = `e2e-tech-${Date.now()}`;
  const url = 'https://technology.example/';
  const now = new Date();
  const recent = new Date(now.getTime() - 3 * 86_400_000);
  const expired = new Date(now.getTime() - 61 * 86_400_000);
  const techIds: string[] = [];
  const resourceIds: string[] = [];
  const observationIds: string[] = [];
  const appLinkIds: string[] = [];
  const previous = process.env.TECH_DETAILS_ENABLED;
  const http = () => request(app.getHttpServer());
  const get = (token?: string, slug = tag) => {
    const req = http().get(`/companies/${slug}`);
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).expect(200);
  };

  beforeAll(async () => {
    process.env.TECH_DETAILS_ENABLED = 'true';
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    setupApiDocs(app);
    await app.init();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    const base = {
      name: tag, domain: 'technology.example', websiteUrl: url, oneLiner: '', description: '',
      hq: '', founded: 0, headcount: 0, status: 'Private', stage: 'Seed', totalRaisedUsd: 0n,
      moderationStatus: 'APPROVED' as const,
    };
    companyId = (await prisma.company.create({ data: { ...base, slug: tag } })).id;
    partnerId = (await prisma.company.create({ data: {
      ...base, slug: `${tag}-partner`, partnerOnly: true, partnerFields: ['websiteUrl', 'domain'],
    } })).id;
    emptyId = (await prisma.company.create({ data: { ...base, slug: `${tag}-empty` } })).id;
    sourceId = (await prisma.source.create({ data: {
      url: `${url}${tag}`, sourceType: 'Company website', retrievedAt: now,
    } })).id;
    const scan = async (owner: string, suffix: string, createdAt: Date) => prisma.companyWebsiteScan.create({ data: {
      companyId: owner, scanKey: `${tag}-${suffix}`, targetUrl: url, targetDomain: 'technology.example',
      detectorVersion: 'v1', createdAt,
    } });
    scanId = (await scan(companyId, 'elected', new Date(now.getTime() - 30 * 86_400_000))).id;
    const duplicate = await scan(companyId, 'duplicate', new Date(now.getTime() - 29 * 86_400_000));
    const partnerScan = await scan(partnerId, 'partner', now);
    const cite = async (entityType: string, entityId: string) => prisma.citation.create({ data: { sourceId, entityType, entityId } });
    for (let i = 0; i < 6; i++) {
      const tech = await prisma.technology.create({ data: {
        slug: `${tag}-${i}`, name: `Technology ${i}`, category: 'CMS', vendorUrl: 'https://vendor.example/',
      } });
      techIds.push(tech.id);
      const observed = await prisma.companyTechnology.create({ data: {
        scanId, technologyId: tech.id, evidenceUrl: url, ruleId: 'generator', evidence: 'Explicit generator',
        firstSeenAt: expired, lastSeenAt: i === 3 ? expired : recent, detectorVersion: 'v1',
        retiredAt: i === 5 ? now : null,
      } });
      observationIds.push(observed.id);
      await cite('companyTechnology', observed.id);
      if (i >= 3) {
        const dup = await prisma.companyTechnology.create({ data: {
          scanId: duplicate.id, technologyId: tech.id, evidenceUrl: url, ruleId: 'generator', evidence: 'Duplicate evidence',
          firstSeenAt: recent, lastSeenAt: recent, detectorVersion: 'v1', suppressedAt: i === 4 ? now : null,
        } });
        observationIds.push(dup.id);
        await cite('companyTechnology', dup.id);
      }
    }
    await prisma.companyTechnology.create({ data: {
      scanId: partnerScan.id, technologyId: techIds[0]!, evidenceUrl: url,
      ruleId: 'generator', evidence: 'Partner technology', firstSeenAt: recent, lastSeenAt: recent, detectorVersion: 'v1',
    } });
    for (let i = 0; i < 6; i++) {
      const resource = await prisma.appResource.create({ data: {
        store: 'APPLE', appId: `${tag}-${i}`, storeUrl: `https://apps.apple.com/app/id${100000 + i}`,
      } });
      resourceIds.push(resource.id);
      const data = {
        companyId, resourceId: resource.id, targetUrl: url, evidenceUrl: url,
        firstSeenAt: expired, lastSeenAt: i === 4 ? expired : recent,
        verifiedAt: i === 3 ? null : recent,
        createdAt: new Date(now.getTime() - 30 * 86_400_000),
      };
      const link = await prisma.companyApp.create({ data: { ...data, provenanceKey: `${tag}-app-${i}` } });
      appLinkIds.push(link.id);
      await cite('companyApp', link.id);
      if (i >= 4) {
        const dup = await prisma.companyApp.create({ data: {
          ...data, provenanceKey: `${tag}-app-duplicate-${i}`, createdAt: recent,
          lastSeenAt: recent, suppressedAt: i === 5 ? now : null,
        } });
        appLinkIds.push(dup.id);
      }
    }
    for (const role of ['USER', 'CONTRIBUTOR'] as const) {
      const user = await prisma.user.create({ data: {
        email: `${tag}-${role}@test.dev`, name: tag, passwordHash: 'unused', role, emailVerifiedAt: now,
      } });
      const token = app.get(JwtService).sign({ sub: user.id, role, email: user.email, tv: 0 });
      if (role === 'USER') { userId = user.id; userJwt = token; }
      else { contributorId = user.id; contributorJwt = token; }
    }
    key = (await app.get(ApiKeysService).create(
      { id: contributorId, role: 'CONTRIBUTOR', emailVerified: true }, { name: tag, scope: 'contributor' },
    )).token;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      if (sourceId) await prisma.source.delete({ where: { id: sourceId } });
      for (const id of [companyId, partnerId, emptyId].filter(Boolean)) await prisma.company.delete({ where: { id } });
      await prisma.technology.deleteMany({ where: { id: { in: techIds } } });
      await prisma.appResource.deleteMany({ where: { id: { in: resourceIds } } });
      for (const id of [contributorId, userId].filter(Boolean)) await prisma.user.delete({ where: { id } });
    }
    if (app) await app.close();
    if (previous === undefined) delete process.env.TECH_DETAILS_ENABLED;
    else process.env.TECH_DETAILS_ENABLED = previous;
  });

  it('previews two rows per open section and cites only those rows', async () => {
    for (const token of [undefined, userJwt]) {
      const { body } = await get(token);
      expect(body.company.companyTechnologies).toHaveLength(2);
      expect(body.company.companyApps).toHaveLength(2);
      expect(body.access.totals).toMatchObject({ companyTechnologies: 3, companyApps: 3 });
      const ids = [...body.company.companyTechnologies, ...body.company.companyApps].map((r: { id: string }) => r.id);
      expect(body.citations.map((c: { entityId: string }) => c.entityId).sort()).toEqual(ids.sort());
    }
  });

  it('excludes expired, retired and group-suppressed rows despite fresh duplicates and fresh Source timestamps', async () => {
    const { body } = await get(contributorJwt);
    expect(body.company.companyTechnologies.map((t: { name: string }) => t.name)).toEqual(['Technology 0', 'Technology 1', 'Technology 2']);
    expect(body.company.companyApps.map((a: { appId: string }) => a.appId)).toEqual([`${tag}-0`, `${tag}-1`, `${tag}-2`]);
    expect(body.company.companyTechnologies[0].lastSeenAt).toBe(recent.toISOString());
    expect(JSON.stringify(body.company.companyApps)).not.toMatch(/rating|downloads|revenue/);
  });

  it('keeps failed scans distinguishable internally without changing public freshness', async () => {
    await prisma.companyWebsiteScan.update({ where: { id: scanId }, data: { outcome: 'RETRYABLE_ERROR', lastAttemptAt: now } });
    const { body } = await get(contributorJwt);
    expect(body.company.companyTechnologies).toHaveLength(3);
    expect(body.company.companyTechnologies[0].lastSeenAt).toBe(recent.toISOString());
    expect(JSON.stringify(body)).not.toContain('RETRYABLE_ERROR');
  });

  it('returns no enrichment evidence for a partner-only anonymous stub', async () => {
    const { body } = await get(undefined, `${tag}-partner`);
    expect(body.company.partnerOnly).toBe(true);
    expect(body.company).not.toHaveProperty('companyTechnologies');
    expect(body.company).not.toHaveProperty('companyApps');
    expect(body.access.totals).not.toHaveProperty('companyTechnologies');
    expect(body.citations).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(url);
  });

  it.each([
    { websiteUrl: url, partnerFields: ['websiteUrl'], target: 'websiteUrl' },
    { websiteUrl: null, partnerFields: ['domain'], target: 'domain' },
  ])('does not leak a masked public-company $target through enrichment evidence or citations', async ({ target, ...data }) => {
    await prisma.company.update({ where: { id: companyId }, data });
    try {
      const anonymous = (await get()).body;
      expect(anonymous.company.masked).toContain(target);
      expect(anonymous.company).not.toHaveProperty('companyTechnologies');
      expect(anonymous.company).not.toHaveProperty('companyApps');
      expect(anonymous.access.totals).not.toHaveProperty('companyTechnologies');
      expect(anonymous.access.totals).not.toHaveProperty('companyApps');
      expect(anonymous.citations).toEqual([]);
      expect(JSON.stringify(anonymous)).not.toContain(url);
      const signedIn = (await get(userJwt)).body;
      expect(signedIn.company.companyTechnologies).toHaveLength(2);
      expect(signedIn.company.companyApps).toHaveLength(2);
      expect(signedIn.citations).toHaveLength(4);
      const v1 = (await http().get(`/v1/companies/${tag}`).set('Authorization', `Bearer ${key}`).expect(200)).body;
      expect(v1.company.companyTechnologies).toHaveLength(3);
    } finally {
      await prisma.company.update({ where: { id: companyId }, data: { websiteUrl: url, partnerFields: [] } });
    }
  });

  it('preserves observations from an unmasked website when only the separate domain field is masked', async () => {
    await prisma.company.update({ where: { id: companyId }, data: { partnerFields: ['domain'] } });
    try {
      const { body } = await get();
      expect(body.company.masked).toContain('domain');
      expect(body.company.companyTechnologies).toHaveLength(2);
      expect(body.company.companyApps).toHaveLength(2);
    } finally {
      await prisma.company.update({ where: { id: companyId }, data: { partnerFields: [] } });
    }
  });

  it('handles missing observations and a changed website without borrowing old evidence', async () => {
    const empty = (await get(undefined, `${tag}-empty`)).body;
    expect(empty.company.companyTechnologies).toEqual([]);
    expect(empty.company.companyApps).toEqual([]);
    await prisma.company.update({ where: { id: companyId }, data: { websiteUrl: 'https://new-target.example/' } });
    try {
      const { body } = await get(contributorJwt);
      expect(body.company.companyTechnologies).toEqual([]);
      expect(body.company.companyApps).toEqual([]);
      expect(body.citations).toEqual([]);
      expect(body.access.totals).toMatchObject({ companyTechnologies: 0, companyApps: 0 });
    } finally {
      await prisma.company.update({ where: { id: companyId }, data: { websiteUrl: url } });
    }
  });

  it('shares the complete contributor projection with /v1 and leaves directories small', async () => {
    const website = (await get(contributorJwt)).body;
    const v1 = (await http().get(`/v1/companies/${tag}`).set('Authorization', `Bearer ${key}`).expect(200)).body;
    expect(v1.company.companyTechnologies).toEqual(website.company.companyTechnologies);
    expect(v1.company.companyApps).toEqual(website.company.companyApps);
    const directory = (await http().get(`/v1/companies?domain=technology.example`).set('Authorization', `Bearer ${key}`).expect(200)).body;
    for (const row of directory.items) {
      expect(row).not.toHaveProperty('companyTechnologies');
      expect(row).not.toHaveProperty('companyApps');
    }
  });

  it('documents optional technology and app fields in the /v1 response schema', async () => {
    const { body } = await http().get('/v1/openapi.json').expect(200);
    const schema = body.paths['/v1/companies/{slug}'].get.responses['200'].content['application/json'].schema;
    expect(schema.properties.company.properties.companyTechnologies.items.properties.lastSeenAt.format).toBe('date-time');
    expect(schema.properties.company.properties.companyApps.items.properties.store.enum).toEqual(['APPLE', 'GOOGLE_PLAY']);
    expect(schema.properties.access.properties.totals.properties.companyTechnologies.type).toBe('integer');
  });

  it('omits all enrichment fields, counts and citations while display is disabled', async () => {
    config.set('TECH_DETAILS_ENABLED', 'false');
    try {
      for (const path of [`/companies/${tag}`, `/v1/companies/${tag}`]) {
        const token = path.startsWith('/v1') ? key : contributorJwt;
        const { body } = await http().get(path).set('Authorization', `Bearer ${token}`).expect(200);
        expect(body.company).not.toHaveProperty('companyTechnologies');
        expect(body.company).not.toHaveProperty('companyApps');
        expect(body.access.totals).not.toHaveProperty('companyTechnologies');
        expect(body.access.totals).not.toHaveProperty('companyApps');
        expect(body.citations).toEqual([]);
      }
    } finally {
      config.set('TECH_DETAILS_ENABLED', 'true');
    }
  });
});
