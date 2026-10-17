import { fundIndexable } from './indexing';
import { publicIngestLabel } from './provenance';

describe('publicIngestLabel', () => {
  it('names the public sources by their documents', () => {
    expect(publicIngestLabel('SEC_EDGAR')).toBe('SEC Form D');
    expect(publicIngestLabel('WIKIDATA')).toBe('Wikidata');
    expect(publicIngestLabel('COMPANIES_HOUSE')).toBe('Companies House');
  });

  it('labels partner data generically', () => {
    expect(publicIngestLabel('PARTNER')).toBe('partner');
  });

  it('never leaks an unlisted internal tag', () => {
    expect(publicIngestLabel('SOME_NEW_TAG')).toBe('automated');
    expect(publicIngestLabel(null)).toBe('automated');
    expect(publicIngestLabel(undefined)).toBe('automated');
    expect(publicIngestLabel('')).toBe('automated');
  });
});

describe('fundIndexable', () => {
  const bare = { commitmentCount: 0 };

  it('keeps a name-and-NAV fund out of the index', () => {
    expect(fundIndexable(bare)).toBe(false);
    expect(fundIndexable({ ...bare, closedUsd: null, targetUsd: null })).toBe(false);
  });

  it('indexes a fund with any public commitment', () => {
    expect(fundIndexable({ commitmentCount: 1 })).toBe(true);
  });

  it('indexes a fund with a size, target, final close or fee', () => {
    expect(fundIndexable({ ...bare, closedUsd: 0 })).toBe(true);
    expect(fundIndexable({ ...bare, targetUsd: 5_000_000 })).toBe(true);
    expect(fundIndexable({ ...bare, finalCloseDate: '2020-01-01' })).toBe(true);
    expect(fundIndexable({ ...bare, managementFeePct: 2 })).toBe(true);
  });
});
