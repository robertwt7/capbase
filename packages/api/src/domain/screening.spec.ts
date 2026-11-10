import {
  COMPANY_QUERY_PARAMS,
  companyQueryToParams,
  hasRoundCriteria,
  isCalendarDate,
  monthsBefore,
  parseCompanyScreen,
  resolveRoundWindow,
  screenApplied,
  validateCompanyScreen,
} from './screening';
import type { CompanyListQuery } from './pagination';

describe('validateCompanyScreen', () => {
  it.each([
    ['raisedMin', 'raisedMax'],
    ['valuationMin', 'valuationMax'],
    ['foundedMin', 'foundedMax'],
    ['headcountMin', 'headcountMax'],
    ['roundMin', 'roundMax'],
  ])('rejects an inverted %s/%s pair, naming the params only', (min, max) => {
    expect(validateCompanyScreen({ [min]: 2010, [max]: 2000 })).toBe(`${min} must not exceed ${max}`);
  });

  it('accepts equal bounds, one-sided bounds and an empty query', () => {
    expect(validateCompanyScreen({ raisedMin: 5, raisedMax: 5 })).toBeNull();
    expect(validateCompanyScreen({ foundedMax: 2000 })).toBeNull();
    expect(validateCompanyScreen({})).toBeNull();
  });

  it('rejects a rolling window mixed with fixed dates', () => {
    expect(validateCompanyScreen({ roundWithin: '12m', roundFrom: '2025-01-01' })).toBe(
      'Use roundWithin or roundFrom/roundTo, not both',
    );
    expect(validateCompanyScreen({ roundWithin: '12m', roundTo: '2025-01-01' })).not.toBeNull();
  });

  it('rejects an unreal date and an inverted date pair', () => {
    expect(validateCompanyScreen({ roundFrom: '2026-02-30' })).toBe('roundFrom must be a real date (YYYY-MM-DD)');
    expect(validateCompanyScreen({ roundTo: '2026-13-01' })).toBe('roundTo must be a real date (YYYY-MM-DD)');
    expect(validateCompanyScreen({ roundFrom: '2025-12-31', roundTo: '2025-01-01' })).toBe(
      'roundFrom must not be after roundTo',
    );
    expect(validateCompanyScreen({ roundFrom: '2025-01-01', roundTo: '2025-01-01' })).toBeNull();
  });

  it('rejects investorOn without investor', () => {
    expect(validateCompanyScreen({ investorOn: 'round' })).toBe('investorOn needs investor');
    expect(validateCompanyScreen({ investorOn: 'any', investor: 'sequoia' })).toBeNull();
  });
});

describe('isCalendarDate', () => {
  it('knows leap years', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2025-02-29')).toBe(false);
    expect(isCalendarDate('2025-2-01')).toBe(false);
  });
});

describe('resolveRoundWindow', () => {
  const now = new Date('2026-11-10T15:30:00.000Z');

  it('resolves a rolling window to the start of the day N months back, up to now', () => {
    expect(resolveRoundWindow({ roundWithin: '12m' }, now)).toEqual({
      from: new Date('2025-11-10T00:00:00.000Z'),
      toExclusive: now,
    });
  });

  it('clamps a month-end rollover and handles leap years', () => {
    expect(monthsBefore(new Date('2026-05-31T08:00:00Z'), 3)).toEqual(new Date('2026-02-28T00:00:00Z'));
    expect(monthsBefore(new Date('2024-05-31T08:00:00Z'), 3)).toEqual(new Date('2024-02-29T00:00:00Z'));
    expect(monthsBefore(new Date('2025-02-28T08:00:00Z'), 12)).toEqual(new Date('2024-02-28T00:00:00Z'));
    expect(monthsBefore(new Date('2026-01-15T08:00:00Z'), 36)).toEqual(new Date('2023-01-15T00:00:00Z'));
  });

  it('makes a fixed window inclusive of roundTo (half-open the day after)', () => {
    expect(resolveRoundWindow({ roundFrom: '2025-01-01', roundTo: '2025-12-31' }, now)).toEqual({
      from: new Date('2025-01-01T00:00:00.000Z'),
      toExclusive: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('leaves either fixed side open', () => {
    expect(resolveRoundWindow({ roundTo: '2025-12-31' }, now)).toEqual({
      toExclusive: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(resolveRoundWindow({ roundFrom: '2025-06-01' }, now)).toEqual({
      from: new Date('2025-06-01T00:00:00.000Z'),
    });
  });

  it('is null without a window', () => {
    expect(resolveRoundWindow({ roundKind: 'Equity' }, now)).toBeNull();
  });
});

describe('screenApplied / hasRoundCriteria', () => {
  it('maps params to filter keys', () => {
    expect(screenApplied({ raisedMax: 5, roundKind: 'Grant', investor: 'x' })).toEqual({
      raised: true,
      valuation: false,
      founded: false,
      headcount: false,
      round: true,
      investor: true,
    });
    expect(screenApplied({ raisedMin: 0 }).raised).toBe(true);
    expect(hasRoundCriteria({ investor: 'x', investorOn: 'round' })).toBe(false);
  });
});

describe('companyQueryToParams', () => {
  const query: CompanyListQuery = {
    sort: 'raised',
    investor: 'sequoia',
    investorOn: 'round',
    page: 3,
    pageSize: 50,
    roundKind: 'Equity',
    roundWithin: '12m',
    raisedMax: 50_000_000,
    raisedMin: 5_000_000,
    country: 'AU',
    sector: 'Fintech',
    q: 'pay',
  };

  it('writes params in canonical order and never the page', () => {
    expect(companyQueryToParams(query).toString()).toBe(
      'q=pay&sector=Fintech&country=AU&raisedMin=5000000&raisedMax=50000000&roundWithin=12m&roundKind=Equity' +
        '&investor=sequoia&investorOn=round&sort=raised',
    );
  });

  it('drops empty values and the defaults (investorOn=any, sort=name)', () => {
    expect(companyQueryToParams({ q: '', investor: 'a', investorOn: 'any', sort: 'name' }).toString()).toBe(
      'investor=a',
    );
  });

  it('keeps a zero bound (a recorded value of at least 0)', () => {
    expect(companyQueryToParams({ raisedMin: 0 }).toString()).toBe('raisedMin=0');
  });

  it('round-trips through parseCompanyScreen', () => {
    const params = companyQueryToParams(query);
    const parsed = parseCompanyScreen((k) => params.get(k) ?? undefined);
    const { q, sector, country, sort, page, pageSize, ...screen } = query;
    void [q, sector, country, sort, page, pageSize];
    expect(parsed).toEqual(screen);
    expect(companyQueryToParams({ q, sector, country, sort, ...parsed }).toString()).toBe(params.toString());
  });

  it('lists every screening param', () => {
    expect(COMPANY_QUERY_PARAMS).toEqual(expect.arrayContaining(['roundFrom', 'roundTo', 'roundMin', 'headcountMax']));
  });
});

describe('parseCompanyScreen (lenient)', () => {
  const parse = (o: Record<string, string>) => parseCompanyScreen((k) => o[k]);

  it('drops malformed and out-of-bounds numbers', () => {
    expect(parse({ raisedMin: '5M', raisedMax: '-1', foundedMin: '1200', headcountMax: '12.5' })).toEqual({});
    expect(parse({ raisedMin: ' 5000000 ', foundedMin: '2015' })).toEqual({ raisedMin: 5_000_000, foundedMin: 2015 });
  });

  it('drops both bounds of an inverted pair', () => {
    expect(parse({ raisedMin: '9', raisedMax: '1', foundedMin: '2000' })).toEqual({ foundedMin: 2000 });
  });

  it('keeps roundWithin over fixed dates, and drops unreal or inverted dates', () => {
    expect(parse({ roundWithin: '12m', roundFrom: '2025-01-01' })).toEqual({ roundWithin: '12m' });
    expect(parse({ roundFrom: '2026-02-30', roundTo: '2026-03-01' })).toEqual({ roundTo: '2026-03-01' });
    expect(parse({ roundFrom: '2026-03-02', roundTo: '2026-03-01' })).toEqual({});
    expect(parse({ roundWithin: '7m', roundKind: 'Loan' })).toEqual({});
  });

  it('drops investorOn without investor and trims the slug', () => {
    expect(parse({ investorOn: 'round' })).toEqual({});
    expect(parse({ investor: '  acme-vc ', investorOn: 'round' })).toEqual({ investor: 'acme-vc', investorOn: 'round' });
  });

  it('always yields a query the validator accepts', () => {
    const q = parse({ raisedMin: '9', raisedMax: '1', roundWithin: '3m', roundTo: 'x', investorOn: 'any' });
    expect(validateCompanyScreen(q)).toBeNull();
  });
});
