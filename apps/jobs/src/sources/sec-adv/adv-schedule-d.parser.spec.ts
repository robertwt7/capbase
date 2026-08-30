import { describe, it, expect } from '@jest/globals';

import type { CsvRow } from '../../util/csv';
import { fundStrategyForAdv, mapScheduleDRow } from './adv-schedule-d.parser';

function row(overrides: CsvRow = {}): CsvRow {
  return {
    FilingID: '1234567',
    'Fund Name': 'ANDREESSEN HOROWITZ FUND X-B, L.P.',
    'Fund ID': '805-1534393064',
    State: 'CA',
    Country: 'United States',
    'Fund Type': 'Venture Capital Fund',
    'Gross Asset Value': '3,030,000,000.00',
    ...overrides,
  };
}

describe('fundStrategyForAdv', () => {
  it.each([
    ['Venture Capital Fund', 'Venture capital'],
    ['Private Equity Fund', 'Private equity'],
    ['Hedge Fund', 'Hedge fund'],
    ['Real Estate Fund', 'Real estate'],
    ['Securitized Asset Fund', 'Securitized asset'],
    ['Liquidity Fund', 'Liquidity'],
    ['Other Private Fund', 'Other'],
  ])('maps %s → %s', (input, expected) => {
    expect(fundStrategyForAdv(input)).toBe(expected);
  });

  it('falls back to Other for an unrecognised or missing type', () => {
    expect(fundStrategyForAdv('Crypto Moonshot Fund')).toBe('Other');
    expect(fundStrategyForAdv('')).toBe('Other');
    expect(fundStrategyForAdv(undefined)).toBe('Other');
  });
});

describe('mapScheduleDRow', () => {
  it('maps a fund with its manager CRD, SEC fund id and gross assets', () => {
    expect(mapScheduleDRow(row(), '160489')).toEqual({
      externalId: '805-1534393064',
      name: 'Andreessen Horowitz Fund X-B, L.P.',
      managerCrd: '160489',
      strategy: 'Venture capital',
      vintageYear: null,
      targetUsd: null,
      closedUsd: null,
      grossAssetsUsd: 3_030_000_000,
      hq: 'CA, United States',
      secFundId: '805-1534393064',
      cikNumber: null,
    });
  });

  it('title-cases the ALL-CAPS name while keeping roman numerals', () => {
    const fund = mapScheduleDRow(row({ 'Fund Name': 'SEQUOIA GROWTH FUND III LP' }), '1');
    expect(fund!.name).toBe('Sequoia Growth Fund III LP');
  });

  it.each([['.00'], [''], ['0.00'], ['   ']])(
    'reports no gross assets rather than $0 for %s',
    (value) => {
      expect(mapScheduleDRow(row({ 'Gross Asset Value': value }), '1')!.grossAssetsUsd).toBeNull();
    },
  );

  it('never invents a vintage, target or closed size — Form ADV asks for none', () => {
    const fund = mapScheduleDRow(row(), '160489')!;
    expect(fund.vintageYear).toBeNull();
    expect(fund.targetUsd).toBeNull();
    expect(fund.closedUsd).toBeNull();
  });

  it('drops a row with no fund name', () => {
    expect(mapScheduleDRow(row({ 'Fund Name': '   ' }), '160489')).toBeNull();
  });

  it('falls back to manager + name when the fund reports no SEC fund id', () => {
    const fund = mapScheduleDRow(row({ 'Fund ID': '', 'Fund Name': 'ACME FUND I' }), '160489')!;
    expect(fund.externalId).toBe('160489|acme fund i');
    expect(fund.secFundId).toBeNull();
  });

  it('omits an empty state or country from the HQ instead of leaving a comma', () => {
    expect(mapScheduleDRow(row({ State: '', Country: 'Cayman Islands' }), '1')!.hq).toBe(
      'Cayman Islands',
    );
    expect(mapScheduleDRow(row({ State: '', Country: '' }), '1')!.hq).toBeNull();
  });
});
