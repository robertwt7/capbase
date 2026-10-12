import { describe, it, expect } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SEARCH_MAX_CHARS } from '@repo/api';

import { SearchQueryDto } from './search-query.dto';

const errorsFor = (query: Record<string, unknown>) =>
  validate(plainToInstance(SearchQueryDto, query), { whitelist: true });

describe('SearchQueryDto', () => {
  it('accepts an ordinary query', async () => {
    expect(await errorsFor({ q: 'stripe' })).toHaveLength(0);
  });

  it('rejects a missing q', async () => {
    expect(await errorsFor({})).not.toHaveLength(0);
  });

  it('rejects a q over the length cap', async () => {
    expect(
      await errorsFor({ q: 'x'.repeat(SEARCH_MAX_CHARS + 1) }),
    ).not.toHaveLength(0);
    expect(await errorsFor({ q: 'x'.repeat(SEARCH_MAX_CHARS) })).toHaveLength(
      0,
    );
  });

  it('rejects a repeated q (an array)', async () => {
    expect(await errorsFor({ q: ['a', 'b'] })).not.toHaveLength(0);
  });
});
