import { describe, expect, it } from '@jest/globals';

import { findNearDuplicate, pairNearDuplicates, type RoundLike } from './round-dedup';

const round = (date: string, amountUsd: number, kind = 'Equity', id = 'r'): RoundLike => ({
  id,
  date: new Date(`${date}T00:00:00Z`),
  amountUsd,
  kind,
});

describe('findNearDuplicate', () => {
  it('matches within 120 days and 25% of the larger amount', () => {
    const existing = [round('2021-01-01', 10_000_000)];
    expect(findNearDuplicate(round('2021-05-01', 8_000_000), existing)).toBe(existing[0]);
    // 120 days exactly is still inside the window.
    expect(findNearDuplicate(round('2021-05-01', 10_000_000), [round('2021-01-01', 10_000_000)])).not.toBeNull();
  });

  it('rejects a date 121 days away', () => {
    expect(findNearDuplicate(round('2021-05-02', 10_000_000), [round('2021-01-01', 10_000_000)])).toBeNull();
  });

  it('rejects an amount more than 25% away', () => {
    // 7.4M vs 10M: a 26% gap.
    expect(findNearDuplicate(round('2021-01-10', 7_400_000), [round('2021-01-01', 10_000_000)])).toBeNull();
    // 7.5M vs 10M: exactly 25%.
    expect(findNearDuplicate(round('2021-01-10', 7_500_000), [round('2021-01-01', 10_000_000)])).not.toBeNull();
  });

  it('treats an unknown amount (0) on either side as compatible', () => {
    expect(findNearDuplicate(round('2021-01-10', 0), [round('2021-01-01', 10_000_000)])).not.toBeNull();
    expect(findNearDuplicate(round('2021-01-10', 5_000_000), [round('2021-01-01', 0)])).not.toBeNull();
  });

  it('never pairs a grant with an equity or debt round', () => {
    expect(findNearDuplicate(round('2021-01-01', 1_000_000, 'Grant'), [round('2021-01-01', 1_000_000)])).toBeNull();
    expect(findNearDuplicate(round('2021-01-01', 1_000_000), [round('2021-01-01', 1_000_000, 'Grant')])).toBeNull();
    expect(
      findNearDuplicate(round('2021-01-01', 1_000_000, 'Debt'), [round('2021-01-01', 1_000_000, 'Equity')]),
    ).not.toBeNull();
    expect(
      findNearDuplicate(round('2021-01-01', 1_000_000, 'Grant'), [round('2021-01-05', 1_000_000, 'Grant')]),
    ).not.toBeNull();
  });

  it('prefers the closest date, then the closest amount', () => {
    const near = round('2021-03-01', 10_000_000, 'Equity', 'near');
    const far = round('2021-01-01', 10_000_000, 'Equity', 'far');
    expect(findNearDuplicate(round('2021-03-10', 10_000_000), [far, near])).toBe(near);

    const exact = round('2021-03-01', 10_000_000, 'Equity', 'exact');
    const off = round('2021-03-01', 9_000_000, 'Equity', 'off');
    expect(findNearDuplicate(round('2021-03-01', 10_000_000), [off, exact])).toBe(exact);
  });

  it('returns null with nothing to compare against', () => {
    expect(findNearDuplicate(round('2021-01-01', 1), [])).toBeNull();
  });
});

describe('pairNearDuplicates', () => {
  it('lets one existing round absorb at most one incoming round — the nearest', () => {
    const formD = round('2021-02-20', 0, 'Equity', 'form-d');
    const seed = round('2021-01-01', 2_000_000, 'Equity', 'seed');
    const seriesA = round('2021-03-01', 10_000_000, 'Equity', 'a');
    const pairs = pairNearDuplicates([seed, seriesA], [formD]);
    expect([...pairs.entries()]).toEqual([[1, formD]]);
  });

  it('pairs each incoming round with its own counterpart', () => {
    const x = round('2021-01-01', 5_000_000, 'Equity', 'x');
    const y = round('2021-04-01', 20_000_000, 'Equity', 'y');
    const pairs = pairNearDuplicates(
      [round('2021-01-05', 5_000_000), round('2021-04-03', 21_000_000)],
      [y, x],
    );
    expect(pairs.get(0)).toBe(x);
    expect(pairs.get(1)).toBe(y);
  });

  it('pairs nothing across kind classes or outside the window', () => {
    expect(pairNearDuplicates([round('2021-01-01', 1, 'Grant')], [round('2021-01-01', 1)]).size).toBe(0);
    expect(pairNearDuplicates([round('2022-01-01', 1)], [round('2021-01-01', 1)]).size).toBe(0);
  });
});
