import { describe, it, expect } from '@jest/globals';

import { FxTable } from './fx';

// Newest first with a trailing comma, exactly as the ECB publishes it.
const CSV = [
  'Date,USD,JPY,GBP,',
  '2024-01-08,1.0950,158.50,0.8600,',
  '2024-01-05,1.0920,158.00,0.8590,',
  '2024-01-04,1.0940,N/A,0.8620,',
  '2024-01-03,1.0919,157.00,0.8630,',
  '',
].join('\n');

const fx = FxTable.parse(CSV);

describe('FxTable.usdPer', () => {
  it('converts GBP as USD-per-EUR over GBP-per-EUR', () => {
    expect(fx.usdPer('GBP', '2024-01-05')).toBeCloseTo(1.092 / 0.859, 10);
  });

  it('falls back to Friday for a weekend date', () => {
    expect(fx.usdPer('GBP', '2024-01-06')).toBe(fx.usdPer('GBP', '2024-01-05'));
    expect(fx.usdPer('GBP', '2024-01-07')).toBe(fx.usdPer('GBP', '2024-01-05'));
  });

  it('skips back past a day the currency was not quoted', () => {
    expect(fx.usdPer('JPY', '2024-01-04')).toBeCloseTo(1.0919 / 157, 10);
  });

  it('uses the last row for a date after it', () => {
    expect(fx.usdPer('GBP', '2030-06-01')).toBeCloseTo(1.095 / 0.86, 10);
  });

  it('is null before the history starts, or more than ten days past a quote', () => {
    expect(fx.usdPer('GBP', '1998-12-31')).toBeNull();
    expect(fx.usdPer('GBP', '2024-01-02')).toBeNull();
  });

  it('handles USD, EUR and unknown currencies', () => {
    expect(fx.usdPer('USD', '1990-01-01')).toBe(1);
    expect(fx.usdPer('EUR', '2024-01-05')).toBeCloseTo(1.092, 10);
    expect(fx.usdPer('XYZ', '2024-01-05')).toBeNull();
    expect(fx.usdPer('GBP', 'not a date')).toBeNull();
  });
});
