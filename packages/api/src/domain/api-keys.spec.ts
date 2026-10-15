import { scopesForRole } from './api-keys';

describe('scopesForRole', () => {
  it('lets a USER hold no key, a CONTRIBUTOR contributor keys, an ADMIN both', () => {
    expect(scopesForRole('USER')).toEqual([]);
    expect(scopesForRole('CONTRIBUTOR')).toEqual(['contributor']);
    expect(scopesForRole('ADMIN')).toEqual(['contributor', 'admin']);
  });
});
