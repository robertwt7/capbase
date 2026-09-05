import type { EntityIdentifier } from '@repo/db';

import { toEntityIdentifier, toEntityIdentifiers } from './identifier.mapper';

function row(over: Partial<EntityIdentifier> = {}): EntityIdentifier {
  return {
    id: 'ei-1',
    scheme: 'CIK',
    value: '0000320193',
    entityType: 'company',
    entityId: 'c-1',
    source: 'BACKFILL',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  } as EntityIdentifier;
}

describe('toEntityIdentifier', () => {
  it('attaches the issuer page, derived rather than stored', () => {
    expect(toEntityIdentifier(row())).toEqual({
      scheme: 'CIK',
      value: '0000320193',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193',
    });
  });

  it('leaves the url null where the issuer publishes no page', () => {
    expect(toEntityIdentifier(row({ scheme: 'TICKER', value: 'NASDAQ:ABNB' })).url).toBeNull();
  });
});

describe('toEntityIdentifiers', () => {
  it('hides DOMAIN — the profile already links the website', () => {
    const out = toEntityIdentifiers([row(), row({ id: 'ei-2', scheme: 'DOMAIN', value: 'acme.com' })]);
    expect(out.map((i) => i.scheme)).toEqual(['CIK']);
  });

  it('orders by the vocabulary, not by insertion, so every profile reads alike', () => {
    const out = toEntityIdentifiers([
      row({ id: '1', scheme: 'UEI', value: 'ZQGGHA8HKDM7' }),
      row({ id: '2', scheme: 'CIK', value: '0000320193' }),
      row({ id: '3', scheme: 'LEI', value: 'HWUPKR0MPOU8FGXBT394' }),
    ]);
    expect(out.map((i) => i.scheme)).toEqual(['LEI', 'CIK', 'UEI']);
  });

  it('orders two values of one scheme by value, so a relisting is stable', () => {
    const out = toEntityIdentifiers([
      row({ id: '1', scheme: 'TICKER', value: 'NYSE:UBER' }),
      row({ id: '2', scheme: 'TICKER', value: 'NASDAQ:ABNB' }),
    ]);
    expect(out.map((i) => i.value)).toEqual(['NASDAQ:ABNB', 'NYSE:UBER']);
  });

  it('returns an empty list for an entity with nothing but a domain', () => {
    expect(toEntityIdentifiers([row({ scheme: 'DOMAIN', value: 'acme.com' })])).toEqual([]);
  });
});
