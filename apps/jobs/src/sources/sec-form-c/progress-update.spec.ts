import { describe, it, expect } from '@jest/globals';

import { parseRaisedUsd, regCfCeilingUsd } from './progress-update';

/** Every string below is copied verbatim from a real C-U filing in the
 *  2016Q2–2026Q2 crowdfunding data sets. */
describe('parseRaisedUsd', () => {
  it.each([
    ['Vigilante Gaming Bar, LLC has raised a total of $119,700.', 119_700],
    [
      'The Offering ended early on June 9, 2026 having raised a total of $10,522.32. ',
      10_522.32,
    ],
    [
      'The Offering successfully reached its Target Offering Amount on June 27, 2026, having closed on funds totaling $147,863.67.',
      147_863.67,
    ],
    ['Total Amount Raised: $22,526.33', 22_526.33],
    [
      'At the close of the offering, the issuer closed on $117,915.14 and 95,308 number of securities.',
      117_915.14,
    ],
    [
      'End of offering. Issuer closed its offering with estimated gross proceeds of $23,612. The foregoing is in regard only to the amount raised under the Section 4(a)(6) exemption.',
      23_612,
    ],
    ['$74,856.00 in investments. Payments are still being processed; final number is yet to be determined.', 74_856],
    ['Raised $46,750', 46_750],
  ])('%s → %s', (text, expected) => {
    expect(parseRaisedUsd(text, null, '2026-06-30')).toBe(expected);
  });

  it('takes the raise, not the goal it fell short of', () => {
    // Naive max-of-all-dollar-amounts returns the goal here.
    const text =
      'The issuer raised $5455.00, which fell below its minimum goal of $25,000.00.';
    expect(parseRaisedUsd(text, 1_000_000, '2020-05-01')).toBe(5_455);
  });

  it('takes the gross amount, not the commission and not the net', () => {
    const text =
      'Offering on Democracy VC MicroVentures platform completed and terminated. ' +
      'Amount raised: $184,363; Commissions to Democracy VC: $12,905.41; ' +
      'net proceeds to the issuer: $171,457.59';
    expect(parseRaisedUsd(text, 1_070_000, '2020-01-15')).toBe(184_363);
  });

  it('ignores a unit price', () => {
    const text = 'The offering closed with 549.5 future equity units sold at $100 each.';
    expect(parseRaisedUsd(text, 500_000, '2022-01-01')).toBeNull();
  });

  it('returns null when the offering reports no amount at all', () => {
    for (const text of [
      'Offering closed unsuccessfully',
      'Offering Closed Unsuccessfully',
      'End of offering',
      '',
      '   ',
    ]) {
      expect(parseRaisedUsd(text, 100_000, '2024-01-01')).toBeNull();
    }
  });

  it('never reports a target as though it were proceeds', () => {
    expect(parseRaisedUsd('Offering target amount of $1,000 has been reached', null, '2021-06-01'))
      .toBeNull();
    expect(parseRaisedUsd('Maximum offering amount of $500,000.', 500_000, '2021-06-01')).toBeNull();
  });

  it('caps a candidate at the maximum the offering registered', () => {
    // A valuation quoted alongside the raise must not become the raise.
    const text = 'The company raised $80,000 at a $4,000,000 pre-money valuation.';
    expect(parseRaisedUsd(text, 100_000, '2023-01-01')).toBe(80_000);
  });

  it('allows a small oversubscription above the registered maximum', () => {
    expect(parseRaisedUsd('Total raised: $102,000', 100_000, '2023-01-01')).toBe(102_000);
    expect(parseRaisedUsd('Total raised: $150,000', 100_000, '2023-01-01')).toBeNull();
  });

  it('falls back to the statutory ceiling when the offering filed no maximum', () => {
    // $2M is legal after the 2021 cap rise, impossible before it.
    expect(parseRaisedUsd('Total raised: $2,000,000', null, '2022-06-01')).toBe(2_000_000);
    expect(parseRaisedUsd('Total raised: $2,000,000', null, '2019-06-01')).toBeNull();
  });
});

describe('regCfCeilingUsd', () => {
  it('is $1.07M before the 2021 cap rise and $5M after', () => {
    expect(regCfCeilingUsd('2021-03-14')).toBe(1_070_000);
    expect(regCfCeilingUsd('2021-03-15')).toBe(5_000_000);
    expect(regCfCeilingUsd(null)).toBe(5_000_000);
  });
});
