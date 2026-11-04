import { describe, expect, it } from '@jest/globals';
import type { Fund as DbFund } from '@repo/db';

import { toFundMandate } from './fund.mapper';

const row = (over: Partial<DbFund> = {}): DbFund =>
  ({
    detailedStrategy: null,
    industries: [],
    verticals: [],
    geographicFocus: [],
    geographicExposure: [],
    domicile: null,
    structure: null,
    legalStructure: null,
    mandateReportedOn: null,
    ...over,
  }) as DbFund;

describe('toFundMandate', () => {
  it('maps a full mandate, the date as YYYY-MM-DD', () => {
    expect(
      toFundMandate(
        row({
          detailedStrategy: 'Early Stage: Seed',
          industries: ['Software', 'Automobiles, Other Vehicles & Parts'],
          verticals: ['Fintech'],
          geographicFocus: ['North America'],
          geographicExposure: ['North America', 'Europe'],
          domicile: 'Delaware',
          structure: 'Commingled',
          legalStructure: 'Limited Partnership',
          mandateReportedOn: new Date('2026-10-14T00:00:00Z'),
        }),
      ),
    ).toEqual({
      detailedStrategy: 'Early Stage: Seed',
      industries: ['Software', 'Automobiles, Other Vehicles & Parts'],
      verticals: ['Fintech'],
      geographicFocus: ['North America'],
      geographicExposure: ['North America', 'Europe'],
      domicile: 'Delaware',
      structure: 'Commingled',
      legalStructure: 'Limited Partnership',
      reportedOn: '2026-10-14',
    });
  });

  it('maps a fund that reports only its structure', () => {
    expect(toFundMandate(row({ structure: 'Separately Managed Account' }))).toMatchObject({
      structure: 'Separately Managed Account',
      industries: [],
      detailedStrategy: null,
      reportedOn: null,
    });
  });

  it('is null for a row with no mandate, even with a reported-on date', () => {
    expect(toFundMandate(row())).toBeNull();
    expect(toFundMandate(row({ mandateReportedOn: new Date('2026-10-14T00:00:00Z') }))).toBeNull();
  });
});
