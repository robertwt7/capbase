import { decodeSavedParams, searchName } from './saved-search-query';
describe('saved company directory query', () => {
  it.each([
    'page=2',
    'pageSize=50',
    'slugs=foo',
    'domain=foo.test',
    'url=https://foo.test',
    'q=a&q=b',
    'stage=unknown',
    'country=XX',
    'raisedMin=9&raisedMax=1',
    'roundFrom=2026-02-30',
    'roundWithin=12m&roundFrom=2025-01-01',
    'q=' + 'x'.repeat(2000),
  ])('rejects invalid persisted params %s', async (params) => {
    await expect(decodeSavedParams(params)).rejects.toThrow();
  });
  it('round trips all screening criteria in canonical order', async () => {
    const result = await decodeSavedParams(
      'sort=name&country=gb&raisedMin=100&roundWithin=12m&investor=sample&investorOn=any&q=+hello+',
    );
    expect(result.params).toBe(
      'q=hello&country=GB&raisedMin=100&roundWithin=12m&investor=sample',
    );
    expect(result.query.roundWithin).toBe('12m');
  });
  it('bounds names without uniqueness', () => {
    expect(searchName('  Same name ')).toBe('Same name');
    expect(() => searchName(' ')).toThrow();
    expect(() => searchName('x'.repeat(101))).toThrow();
  });
});
