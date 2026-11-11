import request from 'supertest';
import {
  DEFAULT_GATE_POLICY,
  resolveGatePolicy,
  type GatePolicy,
} from '@repo/api';
import { featureFixtures } from './feature-fixtures';
import { MonitoringService } from '../src/monitoring/monitoring.service';
import { UpdatesService } from '../src/monitoring/updates.service';
import { SavedSearchesService } from '../src/saved-searches/saved-searches.service';
import { GatePolicyService } from '../src/gate/gate-policy.service';
import { MergeService } from '../src/admin/merge/merge.service';
describe('Opt-in monitoring and private feed (e2e)', () => {
  let f: Awaited<ReturnType<typeof featureFixtures>>;
  let service: MonitoringService;
  let feed: UpdatesService;
  let searches: SavedSearchesService;
  let policy: GatePolicy = DEFAULT_GATE_POLICY;
  const now = new Date();
  const later = new Date(now.getTime() + 3600000);
  beforeAll(async () => {
    f = await featureFixtures();
    service = f.app.get(MonitoringService);
    feed = f.app.get(UpdatesService);
    searches = f.app.get(SavedSearchesService);
    jest
      .spyOn(f.app.get(GatePolicyService), 'current')
      .mockImplementation(() => policy);
  });
  afterAll(async () => {
    await f?.close();
  });
  beforeEach(() => {
    policy = DEFAULT_GATE_POLICY;
  });
  const save = async (userId: string, companyId: string) =>
    f.prisma.savedCompany.create({ data: { userId, companyId } });
  const count = (userId: string) =>
    f.prisma.monitorEvent.count({ where: { userId } });
  it('baselines silently, records one new match, and never duplicates reentry', async () => {
    const u = await f.user();
    const c = await f.company();
    await f.round(c.id, { date: new Date(now.getTime() - 86400000) });
    const search = await searches.create(
      u.id,
      'Rolling',
      `q=${f.prefix}&roundWithin=12m`,
    );
    await service.setSearch(u.id, search.id, true, now);
    expect(await count(u.id)).toBe(0);
    const fresh = await f.company();
    await f.round(fresh.id, { date: new Date(now.getTime() - 86400000) });
    await service.runOnce(later);
    expect(await count(u.id)).toBe(1);
    await service.runOnce(new Date(now.getTime() + 400 * 86400000));
    await service.runOnce(later);
    expect(await count(u.id)).toBe(1);
    const page = await feed.list(u.id);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.company.slug).toBe(fresh.slug);
    expect(page.items[0]!.search?.name).toBe('Rolling');
    await service.setSearch(u.id, search.id, false);
    expect((await feed.list(u.id)).items).toHaveLength(0);
    await searches.remove(u.id, search.id);
    expect(await count(u.id)).toBe(0);
    expect((await feed.list(u.id)).items).toHaveLength(0);
  });
  it('detects late approvals and direct approved insertion, excludes pending/rejected/grants forever', async () => {
    const u = await f.user();
    const c = await f.company();
    await save(u.id, c.id);
    await f.round(c.id);
    await service.setCompany(u.id, c.slug, true, now);
    expect(await count(u.id)).toBe(0);
    const pending = await f.round(c.id, { moderationStatus: 'PENDING' });
    await f.round(c.id, { moderationStatus: 'REJECTED' });
    const grant = await f.round(c.id, { kind: 'Grant' });
    await service.runOnce(later);
    expect(await count(u.id)).toBe(0);
    await f.prisma.fundingRound.update({
      where: { id: pending.id },
      data: { moderationStatus: 'APPROVED' },
    });
    await f.round(c.id, { kind: 'Debt' });
    await f.prisma.fundingRound.update({
      where: { id: grant.id },
      data: { kind: 'Equity' },
    });
    await service.runOnce(later);
    expect(await count(u.id)).toBe(2);
    await service.runOnce(later);
    expect(await count(u.id)).toBe(2);
    const page = await feed.list(u.id);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((i) => i.round?.date === '2015-01-01')).toBe(true);
    await f.prisma.fundingRound.update({
      where: { id: pending.id },
      data: { moderationStatus: 'REJECTED' },
    });
    expect((await feed.list(u.id)).items).toHaveLength(1);
    await service.setCompany(u.id, c.slug, false);
    expect((await feed.list(u.id)).items).toHaveLength(0);
  });
  it('preseeds moved rounds and preserves monitoring through merge/unmerge', async () => {
    const u = await f.user();
    const admin = await f.user('ADMIN');
    const a = await f.company();
    const b = await f.company();
    await save(u.id, a.id);
    await save(u.id, b.id);
    await service.setCompany(u.id, a.slug, true, now);
    await service.setCompany(u.id, b.slug, true, now);
    await f.round(b.id);
    const merged = await f.app
      .get(MergeService)
      .merge('company', a.id, b.id, admin.id);
    await service.runOnce(later);
    expect(await count(u.id)).toBe(0);
    const round = await f.round(a.id);
    await service.runOnce(later);
    await service.runOnce(later);
    expect(await count(u.id)).toBe(1);
    expect((await feed.list(u.id)).items[0]!.company.slug).toBe(a.slug);
    await f.app.get(MergeService).unmerge(merged.mergeRecordId, admin.id);
    expect(
      (
        await f.prisma.savedCompany.findUniqueOrThrow({
          where: { userId_companyId: { userId: u.id, companyId: b.id } },
        })
      ).monitoredAt,
    ).not.toBeNull();
    expect(
      (
        await f.prisma.monitorEvent.findFirstOrThrow({
          where: { userId: u.id },
        })
      ).roundId,
    ).toBe(round.id);
  });
  it('carries a search\'s memory of a merged-away company to the survivor', async () => {
    const u = await f.user();
    const admin = await f.user('ADMIN');
    const loser = await f.company();
    await f.round(loser.id, { date: new Date(now.getTime() - 86400000) });
    const survivor = await f.company();
    const search = await searches.create(u.id, 'Merged', `q=${f.prefix}&roundWithin=12m`);
    await service.setSearch(u.id, search.id, true, now);
    // The survivor only matches once the loser's recent round moves onto it.
    await f.app.get(MergeService).merge('company', survivor.id, loser.id, admin.id);
    await service.runOnce(later);
    expect(
      await f.prisma.monitorEvent.count({ where: { searchId: search.id } }),
    ).toBe(0);
  });
  it('rebaselines after access lapses without delivering gap history', async () => {
    const u = await f.user('USER');
    const contribution = await f.company({
      submittedBy: { connect: { id: u.id } },
    });
    const c = await f.company();
    await save(u.id, c.id);
    await service.setCompany(u.id, c.slug, true, now);
    await f.prisma.company.update({
      where: { id: contribution.id },
      data: { createdAt: new Date(now.getTime() - 31 * 86400000) },
    });
    await service.runOnce(later);
    await f.round(c.id);
    expect(
      (
        await f.prisma.savedCompany.findUniqueOrThrow({
          where: { userId_companyId: { userId: u.id, companyId: c.id } },
        })
      ).monitorStatus,
    ).toBe('baselining');
    await expect(feed.list(u.id)).rejects.toThrow('Current full access');
    await f.company({ submittedBy: { connect: { id: u.id } } });
    await service.runOnce(later);
    expect(await count(u.id)).toBe(0);
    await f.round(c.id);
    await service.runOnce(later);
    expect(await count(u.id)).toBe(1);
  });
  it('pauses unavailable criteria instead of broadening a search, and rebaselines on restoration', async () => {
    const u = await f.user();
    const search = await searches.create(
      u.id,
      'Financing',
      `q=${f.prefix}&roundWithin=12m`,
    );
    await service.setSearch(u.id, search.id, true, now);
    policy = resolveGatePolicy({
      sections: [
        {
          section: 'companyRounds',
          ...DEFAULT_GATE_POLICY.sections.companyRounds,
          signedOut: 'hidden',
          signedIn: 'hidden',
          unlocked: 'hidden',
        },
      ],
      fields: [],
    }).policy;
    await service.runOnce(later);
    expect(
      (
        await f.prisma.savedSearch.findUniqueOrThrow({
          where: { id: search.id },
        })
      ).monitorStatus,
    ).toBe('unavailable');
    const c = await f.company();
    await f.round(c.id, { date: new Date(now.getTime() - 86400000) });
    policy = DEFAULT_GATE_POLICY;
    await service.runOnce(later);
    expect(await count(u.id)).toBe(0);
  });
  it('suppresses previewed funding and masks the basic watchlist for a locked user', async () => {
    const u = await f.user();
    const c = await f.company({
      totalRaisedUsd: 987654321987n,
      partnerFields: ['totalRaisedUsd'],
    });
    await save(u.id, c.id);
    await service.setCompany(u.id, c.slug, true, now);
    await f.round(c.id, { amountUsd: 987654321987n });
    await service.runOnce(later);
    policy = resolveGatePolicy({
      sections: [
        {
          section: 'companyRounds',
          ...DEFAULT_GATE_POLICY.sections.companyRounds,
          unlocked: 'preview',
          previewRows: 1,
        },
      ],
      fields: [
        {
          entity: 'company',
          field: 'totalRaisedUsd',
          audience: 'contributors',
          partnerAudience: 'contributors',
        },
      ],
    }).policy;
    const page = await feed.list(u.id);
    expect(page.items).toEqual([]);
    expect(JSON.stringify(page)).not.toContain('987654321987');
    const locked = await f.user('USER');
    await save(locked.id, c.id);
    const res = await request(f.app.getHttpServer())
      .get('/auth/me/saved-companies')
      .auth(locked.token, { type: 'bearer' })
      .expect(200);
    expect(res.body[0].totalRaisedUsd).toBe(0);
    expect(res.body[0].masked).toContain('totalRaisedUsd');
    expect(JSON.stringify(res.body)).not.toContain('987654321987');
  });
  it('denies every new route to locked callers and foreign source ids to other owners', async () => {
    const owner = await f.user();
    const other = await f.user();
    const locked = await f.user('USER');
    const search = await searches.create(owner.id, 'Private', '');
    const c = await f.company();
    await save(owner.id, c.id);
    const http = () => request(f.app.getHttpServer());
    for (const path of [
      `saved-searches/${search.id}/monitoring`,
      `saved-companies/${c.slug}/monitoring`,
    ])
      for (const method of ['put', 'delete'] as const) {
        await http()
          [method](`/auth/me/${path}`)
          .auth(locked.token, { type: 'bearer' })
          .expect(403);
        await http()
          [method](`/auth/me/${path}`)
          .auth(other.token, { type: 'bearer' })
          .expect(404);
      }
    await http()
      .get('/auth/me/updates')
      .auth(locked.token, { type: 'bearer' })
      .expect(403);
    await http().get('/auth/me/updates').expect(401);
  });
});
