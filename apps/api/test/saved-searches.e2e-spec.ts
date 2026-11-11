import request from 'supertest';
import { featureFixtures } from './feature-fixtures';
import { SavedSearchesService } from '../src/saved-searches/saved-searches.service';
import { COMPANY_QUERY_VERSION } from '@repo/api';
describe('Private saved searches (e2e)', () => {
  let f: Awaited<ReturnType<typeof featureFixtures>>;
  let owner: Awaited<ReturnType<typeof f.user>>;
  let other: typeof owner;
  let locked: typeof owner;
  beforeAll(async () => {
    f = await featureFixtures();
    owner = await f.user();
    other = await f.user();
    locked = await f.user('USER');
  });
  afterAll(async () => {
    await f?.close();
  });
  const http = () => request(f.app.getHttpServer());
  it('requires authentication and current full access, including service calls', async () => {
    await http().get('/auth/me/saved-searches').expect(401);
    const response = await http()
      .get('/auth/me/saved-searches')
      .auth(locked.token, { type: 'bearer' })
      .expect(403);
    expect(response.body.code).toBe('FULL_ACCESS_REQUIRED');
    await expect(
      f.app.get(SavedSearchesService).list(locked.id),
    ).rejects.toThrow('Current full access');
    const unlocked = await f.user('USER');
    await f.company({ submittedBy: { connect: { id: unlocked.id } } });
    const admin = await f.user('ADMIN');
    for (const user of [owner, unlocked, admin])
      await http()
        .get('/auth/me/saved-searches')
        .auth(user.token, { type: 'bearer' })
        .expect(200);
  });
  it('round trips screening, allows duplicate names, and scopes rename/delete by owner', async () => {
    const params =
      'roundWithin=12m&investor=fixture-investor&raisedMin=1000&raisedMax=99999999&country=AU';
    const create = () =>
      http()
        .post('/auth/me/saved-searches')
        .auth(owner.token, { type: 'bearer' })
        .send({ name: '  Screening  ', params })
        .expect(201);
    const a = await create();
    const b = await create();
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.params).toBe(
      'country=AU&raisedMin=1000&raisedMax=99999999&roundWithin=12m&investor=fixture-investor',
    );
    expect(a.body.name).toBe('Screening');
    expect(a.body.runnable).toBe(true);
    for (const method of ['patch', 'delete'] as const)
      await http()
        [method](`/auth/me/saved-searches/${a.body.id}`)
        .auth(other.token, { type: 'bearer' })
        .send({ name: 'Stolen' })
        .expect(404);
    await http()
      .patch(`/auth/me/saved-searches/${a.body.id}`)
      .auth(owner.token, { type: 'bearer' })
      .send({ name: 'Renamed' })
      .expect(200);
    await http()
      .delete(`/auth/me/saved-searches/${a.body.id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(200);
  });
  it('paginates by keyset and safely lists/deletes unsupported versions', async () => {
    const row = await f.prisma.savedSearch.create({
      data: {
        userId: owner.id,
        name: 'Unsupported',
        version: COMPANY_QUERY_VERSION + 1,
        params: '',
      },
    });
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const result = await http()
        .get(
          `/auth/me/saved-searches?limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        )
        .auth(owner.token, { type: 'bearer' })
        .expect(200);
      for (const item of result.body.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
        if (item.id === row.id) expect(item.runnable).toBe(false);
      }
      cursor = result.body.nextCursor;
    } while (cursor);
    expect(seen.has(row.id)).toBe(true);
    await http()
      .put(`/auth/me/saved-searches/${row.id}/monitoring`)
      .auth(owner.token, { type: 'bearer' })
      .expect(400);
    await http()
      .delete(`/auth/me/saved-searches/${row.id}`)
      .auth(owner.token, { type: 'bearer' })
      .expect(200);
  });
  it.each([
    'page=2',
    'slugs=secret',
    'domain=secret',
    'q=a&q=b',
    'roundMin=9&roundMax=1',
    'roundKind=invalid',
  ])('rejects injected or invalid params %s', async (params) => {
    await http()
      .post('/auth/me/saved-searches')
      .auth(owner.token, { type: 'bearer' })
      .send({ name: 'Test', params })
      .expect(400);
  });
});
