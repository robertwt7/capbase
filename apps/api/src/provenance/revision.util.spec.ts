import { describe, it, expect } from '@jest/globals';
import { Prisma } from '@repo/db';

import { createRevision, toJsonValue } from './revision.util';

describe('toJsonValue', () => {
  it('converts BigInt money columns to numbers', () => {
    // JSON.stringify throws outright on a BigInt, so this is not cosmetic.
    expect(toJsonValue(24_000_000_000n)).toBe(24_000_000_000);
    expect(() => JSON.stringify(toJsonValue(1000n))).not.toThrow();
  });

  it('converts Dates to ISO strings', () => {
    expect(toJsonValue(new Date('2024-03-01T00:00:00.000Z'))).toBe('2024-03-01T00:00:00.000Z');
  });

  it('stores a genuine null as JsonNull, not SQL NULL', () => {
    // Bare null would mean "no value recorded", a different fact from
    // "the field was cleared".
    expect(toJsonValue(null)).toBe(Prisma.JsonNull);
    expect(toJsonValue(undefined)).toBe(Prisma.JsonNull);
  });

  it('preserves arrays and primitives, converting nested values', () => {
    expect(toJsonValue(['Fintech', 'Payments'])).toEqual(['Fintech', 'Payments']);
    expect(toJsonValue([1n, 2n])).toEqual([1, 2]);
    expect(toJsonValue('SF')).toBe('SF');
    expect(toJsonValue(0)).toBe(0);
    expect(toJsonValue(false)).toBe(false);
  });

  it('converts values nested inside objects, keeping inner nulls as JSON null', () => {
    expect(toJsonValue({ amountUsd: 500n, lead: null })).toEqual({
      amountUsd: 500,
      lead: null,
    });
  });
});

describe('createRevision', () => {
  it('builds a whole-row CREATE entry attributed to the acting admin', () => {
    const row = createRevision({
      companyId: 'c1',
      entityType: 'round',
      entityId: 'r1',
      after: { name: 'Series B', amountUsd: 75n },
      actorUserId: 'admin1',
    });

    expect(row).toMatchObject({
      companyId: 'c1',
      entityType: 'round',
      entityId: 'r1',
      field: '',
      action: 'CREATE',
      actor: 'ADMIN',
      actorUserId: 'admin1',
      after: { name: 'Series B', amountUsd: 75 },
    });
    // A newly published row has no prior state to record.
    expect(row.before).toBe(Prisma.JsonNull);
  });
});
