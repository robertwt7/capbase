import { describe, it, expect } from '@jest/globals';

import {
  toAcquisition,
  toDiversity,
  toExit,
  toFundingRound,
  toInvestorHolding,
  toPerson,
} from './company.mapper';

// Row identity is what a Citation or Revision anchors to. Without it the UI has
// no way to attach a marker to *this* round rather than the whole company, so
// every child mapper must emit it.
describe('company.mapper row identity', () => {
  it('emits id from toFundingRound', () => {
    const round = toFundingRound({
      id: 'r1',
      companyId: 'c1',
      name: 'Series B',
      date: new Date('2024-03-01'),
      amountUsd: 75n,
      postMoneyUsd: null,
      lead: null,
      investors: [],
    } as never);
    expect(round.id).toBe('r1');
  });

  it('emits id from toPerson', () => {
    expect(toPerson({ id: 'p1', name: 'Mara', role: 'CEO', since: 2016 } as never).id).toBe('p1');
  });

  it('emits id from toInvestorHolding', () => {
    const holding = toInvestorHolding({
      id: 'h1',
      name: 'Sequoia Capital',
      type: 'Venture',
      firstRound: 'Series B',
      rounds: 2,
    } as never);
    expect(holding.id).toBe('h1');
  });

  it('emits id from toAcquisition', () => {
    const deal = toAcquisition({
      id: 'a1',
      target: 'Ledgerline',
      date: new Date('2022-02-09'),
      amountUsd: null,
      rationale: 'Tuck-in.',
    } as never);
    expect(deal.id).toBe('a1');
  });

  it('emits id from toExit', () => {
    const exit = toExit({
      id: 'e1',
      type: 'IPO',
      date: new Date('2023-09-15'),
      valueUsd: null,
      detail: 'Listed.',
    } as never);
    expect(exit.id).toBe('e1');
  });

  it('emits id from toDiversity', () => {
    expect(
      toDiversity({
        id: 'd1',
        label: 'Board',
        value: '3 of 7',
        note: '',
      } as never).id,
    ).toBe('d1');
  });
});
