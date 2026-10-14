import { describe, it, expect } from '@jest/globals';

import type { CsvRow } from '../../util/csv';
import { keepReason, toRecord } from './companies-house.parser';

/** Shaped on a real row of the 2026-10-01 snapshot (headers already trimmed). */
function row(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    CompanyName: 'ACME ROBOTICS LIMITED',
    CompanyNumber: '05002194',
    'RegAddress.PostTown': 'MILTON KEYNES',
    'RegAddress.Country': 'ENGLAND',
    CompanyCategory: 'Private Limited Company',
    CompanyStatus: 'Active',
    IncorporationDate: '11/09/2012',
    'Accounts.AccountCategory': 'FULL',
    'SICCode.SicText_1': '62020 - Information technology consultancy activities',
    'SICCode.SicText_2': '72190 - Other research and experimental development on natural sciences and engineering',
    'SICCode.SicText_3': '',
    'SICCode.SicText_4': '',
    ...overrides,
  };
}

const NONE = new Set<string>();

describe('keepReason', () => {
  it('keeps an active FULL / GROUP / MEDIUM share-capital company', () => {
    expect(keepReason(row(), NONE)).toBe('slice');
    expect(keepReason(row({ 'Accounts.AccountCategory': 'GROUP' }), NONE)).toBe('slice');
    expect(keepReason(row({ 'Accounts.AccountCategory': 'MEDIUM' }), NONE)).toBe('slice');
  });

  it('keeps an active FULL public limited company', () => {
    expect(keepReason(row({ CompanyCategory: 'Public Limited Company' }), NONE)).toBe('slice');
  });

  it('drops micro, dormant and exempt filers', () => {
    for (const category of ['MICRO ENTITY', 'TOTAL EXEMPTION FULL', 'DORMANT', 'NO ACCOUNTS FILED', 'SMALL']) {
      expect(keepReason(row({ 'Accounts.AccountCategory': category }), NONE)).toBeNull();
    }
  });

  it('drops guarantee companies, LLPs and the rest of the non-share-capital forms', () => {
    expect(
      keepReason(
        row({ CompanyCategory: 'PRI/LTD BY GUAR/NSC (Private, limited by guarantee, no share capital)' }),
        NONE,
      ),
    ).toBeNull();
    expect(keepReason(row({ CompanyCategory: 'Limited Liability Partnership' }), NONE)).toBeNull();
  });

  it('drops a large company that is not active', () => {
    expect(keepReason(row({ CompanyStatus: 'Liquidation' }), NONE)).toBeNull();
  });

  it('keeps a number we already hold whatever its size or status', () => {
    const known = new Set(['05002194']);
    expect(keepReason(row({ 'Accounts.AccountCategory': 'MICRO ENTITY' }), known)).toBe('known');
    expect(keepReason(row({ CompanyStatus: 'In Administration' }), known)).toBe('known');
  });

  it('matches a known number however the register pads it', () => {
    expect(keepReason(row({ CompanyNumber: '5002194', 'Accounts.AccountCategory': 'DORMANT' }), new Set(['05002194']))).toBe(
      'known',
    );
  });

  it('skips a row with no usable company number', () => {
    expect(keepReason(row({ CompanyNumber: '' }), NONE)).toBeNull();
  });
});

describe('toRecord', () => {
  it('maps a size-slice company', () => {
    const r = toRecord(row(), 'slice');
    expect(r.source).toBe('COMPANIES_HOUSE');
    expect(r.companyExternalId).toBe('05002194');
    expect(r.rounds).toBeUndefined();
    expect(r.people).toBeUndefined();
    expect(r.company).toEqual({
      name: 'Acme Robotics Limited',
      legalName: 'ACME ROBOTICS LIMITED',
      hq: 'Milton Keynes, United Kingdom',
      countryCode: 'GB',
      foundedYear: 2012,
      industry: [
        'Information technology consultancy activities',
        'Other research and experimental development on natural sciences and engineering',
      ],
      primarySector: 'Technology',
      stage: 'Late stage',
      status: 'Private',
      operatingStatus: 'Active',
      companyType: 'For profit',
      totalRaisedUsd: 0,
      oneLiner: 'UK private limited company incorporated 2012.',
      description:
        'Acme Robotics Limited is a UK private limited company registered at Companies House (05002194), incorporated 2012-09-11, filing full accounts.',
      identifiers: [{ scheme: 'COMPANIES_HOUSE', value: '05002194' }],
    });
  });

  it('marks a PLC public', () => {
    const r = toRecord(row({ CompanyCategory: 'Public Limited Company' }), 'slice');
    expect(r.company).toMatchObject({ stage: 'Public', status: 'Public' });
  });

  it('gives a known small company Seed, and no operating status unless active', () => {
    const r = toRecord(
      row({ CompanyStatus: 'Liquidation', 'Accounts.AccountCategory': 'MICRO ENTITY' }),
      'known',
    );
    expect(r.company).toMatchObject({ stage: 'Seed', operatingStatus: null });
  });

  it('copes with missing dates, towns and SIC codes', () => {
    const r = toRecord(
      row({ IncorporationDate: '', 'RegAddress.PostTown': '', 'SICCode.SicText_1': 'None Supplied', 'SICCode.SicText_2': '' }),
      'known',
    );
    expect(r.company).toMatchObject({
      foundedYear: 0,
      hq: 'United Kingdom',
      industry: [],
      primarySector: null,
      oneLiner: 'UK private limited company.',
    });
  });

  it('leaves the sector null for a holding company', () => {
    const r = toRecord(row({ 'SICCode.SicText_1': '64209 - Activities of other holding companies n.e.c.' }), 'slice');
    expect(r.company.primarySector).toBeNull();
  });
});
