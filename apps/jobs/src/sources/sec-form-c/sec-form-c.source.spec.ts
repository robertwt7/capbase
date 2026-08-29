import { describe, it, expect } from '@jest/globals';

import { toRecord } from './sec-form-c.source';
import type { FormCOffering } from './form-c.parser';

function offering(overrides: Partial<FormCOffering> = {}): FormCOffering {
  return {
    fileNumber: '020-11111',
    cik: '1779469',
    offering: {
      accession: 'acc-c',
      filedAt: '2024-01-15',
      info: {
        NAMEOFISSUER: 'Vigilante Gaming Bar, LLC',
        ISSUERWEBSITE: 'https://www.vigilantegaming.com',
        CITY: 'FRESNO',
        STATEORCOUNTRY: 'CA',
        DATEINCORPORATION: '2018-10-18',
        COMPANYNAME: 'Wefunder Portal LLC',
      },
      disclosure: {
        CURRENTEMPLOYEES: '4',
        MAXIMUMOFFERINGAMOUNT: '500000.0',
        SECURITYOFFEREDTYPE: 'Other',
      },
    },
    signers: [{ name: 'Brian Wynne', title: 'CEO' }],
    ...overrides,
  };
}

const withRaise = (o: FormCOffering, text: string, filedAt = '2024-08-01'): FormCOffering => ({
  ...o,
  progress: {
    accession: `${o.fileNumber}-u`,
    filedAt,
    info: { PROGRESSUPDATE: text },
    disclosure: {},
  },
});

describe('Form C toRecord', () => {
  it('maps the issuer facts from its newest offering', () => {
    const record = toRecord('1779469', [withRaise(offering(), 'Total Amount Raised: $119,700')]);

    expect(record.source).toBe('SEC_FORM_C');
    expect(record.companyExternalId).toBe('1779469');
    expect(record.company).toMatchObject({
      name: 'Vigilante Gaming Bar, LLC',
      hq: 'Fresno, CA',
      foundedYear: 2018,
      domain: 'vigilantegaming.com',
      headcount: 4,
      stage: 'Seed',
      status: 'Private',
      totalRaisedUsd: 119_700,
    });
    // Form C publishes no industry, so these rows are honestly unclassified.
    expect(record.company.industry).toEqual([]);
    expect(record.company.primarySector).toBeNull();
    expect(record.company.oneLiner).toContain('Wefunder Portal LLC');
  });

  it('emits one round per offering, newest first, dated by the progress update', () => {
    const older = offering({ fileNumber: '020-A' });
    older.offering.filedAt = '2023-01-10';
    const newer = offering({ fileNumber: '020-B' });
    newer.offering.filedAt = '2025-01-10';

    const record = toRecord('99', [
      withRaise(older, 'Raised $50,000', '2023-05-01'),
      withRaise(newer, 'Raised $75,000', '2025-05-01'),
    ]);

    expect(record.rounds).toEqual([
      {
        externalId: '020-B',
        name: 'Crowdfunding raise (Reg CF)',
        date: '2025-05-01',
        amountUsd: 75_000,
        kind: 'Equity',
      },
      {
        externalId: '020-A',
        name: 'Crowdfunding raise (Reg CF)',
        date: '2023-05-01',
        amountUsd: 50_000,
        kind: 'Equity',
      },
    ]);
    expect(record.company.totalRaisedUsd).toBe(125_000);
  });

  it('contributes no round when no progress update reports an amount', () => {
    // The company still lands with its metadata and officers — publishing the
    // target as though it were proceeds is the failure being avoided.
    const noUpdate = toRecord('99', [offering()]);
    expect(noUpdate.rounds).toBeUndefined();
    expect(noUpdate.company.totalRaisedUsd).toBe(0);
    expect(noUpdate.people).toHaveLength(1);

    const failed = toRecord('99', [withRaise(offering(), 'Offering closed unsuccessfully')]);
    expect(failed.rounds).toBeUndefined();
  });

  it('marks a debt offering as Debt', () => {
    const debt = offering();
    debt.offering.disclosure.SECURITYOFFEREDTYPE = 'Debt';
    const record = toRecord('99', [withRaise(debt, 'Raised $40,000')]);
    expect(record.rounds![0]!.kind).toBe('Debt');
  });

  it('publishes no domain for a platform-hosted website', () => {
    const hosted = offering();
    hosted.offering.info.ISSUERWEBSITE = 'https://medium.com/@issuer';
    const record = toRecord('99', [hosted]);
    expect(record.company.domain).toBeUndefined();
    expect(record.company.websiteUrl).toBe('https://medium.com/@issuer');
  });

  it('keys people by CIK and drops entities that signed for the issuer', () => {
    const record = toRecord('1779469', [
      offering({
        signers: [
          { name: 'Brian Wynne', title: 'CEO' },
          { name: 'Vigilante Gaming Bar, LLC', title: 'Issuer' },
        ],
      }),
    ]);

    expect(record.people).toEqual([
      {
        externalId: '1779469:person:brian-wynne',
        name: 'Brian Wynne',
        role: 'CEO',
        title: 'CEO',
        since: 2024,
      },
    ]);
  });

  it('names an issuer whose filing left the name blank', () => {
    const blank = offering();
    blank.offering.info.NAMEOFISSUER = '';
    expect(toRecord('99', [blank]).company.name).toBe('Reg CF issuer 99');
  });
});
