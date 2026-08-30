import { describe, it, expect } from '@jest/globals';

import { fundStrategyForFormD } from './fund-strategy';

describe('fundStrategyForFormD', () => {
  it.each([
    ['Venture Capital Fund', 'Venture capital'],
    ['Private Equity Fund', 'Private equity'],
    ['Hedge Fund', 'Hedge fund'],
    ['Other Investment Fund', 'Other'],
  ])('maps the Form D value %s → %s', (input, expected) => {
    expect(fundStrategyForFormD(input)).toBe(expected);
  });

  it('maps an unrecognised type to Other rather than dropping the fund', () => {
    expect(fundStrategyForFormD('Digital Asset Fund')).toBe('Other');
  });

  it('reports nothing when the filing declared no fund type', () => {
    // Null, not 'Other': a filing that ticked no box has said nothing, and the
    // ADV strategy for the same fund must be allowed to stand.
    expect(fundStrategyForFormD('')).toBeNull();
    expect(fundStrategyForFormD(undefined)).toBeNull();
  });
});
