import { describe, it, expect } from '@jest/globals';

import type { XlsxRow } from '../../util/xlsx';
import { InnovateUkAggregator, excelSerialToIso, type UsdRates } from './innovate-uk.parser';

/** A flat 1.25 USD/GBP, so the arithmetic in the assertions stays readable. */
const FX: UsdRates = { usdPer: (c) => (c === 'GBP' ? 1.25 : null) };

/** Shaped on a real row of the FY2016/17 → present file. */
function row(overrides: Partial<XlsxRow> = {}): XlsxRow {
  return {
    'Project Number': '10001',
    'Innovate UK Product Type': 'Collaborative R&D',
    'Participant Name': 'ACME ROBOTICS LIMITED',
    CRN: '5002194',
    'Project Start Date': '44228', // 2021-02-01
    'Award Offered (£)': '425000',
    'Participant Withdrawn From Project': 'Active',
    'Project Status': 'Live',
    'Enterprise Size': 'Micro/Small',
    'Address Region': 'North East',
    ...overrides,
  };
}

function aggregate(rows: XlsxRow[], fx: UsdRates = FX) {
  const agg = new InnovateUkAggregator(fx);
  rows.forEach((r) => agg.add(r));
  return { records: agg.records(), drops: agg.drops };
}

describe('excelSerialToIso', () => {
  it('converts Excel serial days with the 1899-12-30 epoch', () => {
    expect(excelSerialToIso(44228)).toBe('2021-02-01');
    expect(excelSerialToIso(46113)).toBe('2026-04-01');
    expect(excelSerialToIso(40544)).toBe('2011-01-01');
  });
});

describe('InnovateUkAggregator', () => {
  it('maps a grantee keyed by its zero-padded CRN, with the award in pounds and dollars', () => {
    const { records } = aggregate([row()]);
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.source).toBe('INNOVATE_UK');
    expect(r.companyExternalId).toBe('05002194');
    expect(r.company).toMatchObject({
      name: 'Acme Robotics Limited',
      legalName: 'ACME ROBOTICS LIMITED',
      hq: 'North East, United Kingdom',
      countryCode: 'GB',
      foundedYear: 0,
      stage: 'Seed',
      companyType: 'For profit',
      totalRaisedUsd: 0,
      identifiers: [{ scheme: 'COMPANIES_HOUSE', value: '05002194' }],
    });
    expect(r.rounds).toEqual([
      {
        externalId: '10001:05002194',
        name: 'Innovate UK grant — Collaborative R&D',
        date: '2021-02-01',
        kind: 'Grant',
        currency: 'GBP',
        amountLocal: 425_000,
        amountUsd: 531_250,
      },
    ]);
  });

  it('keeps businesses only', () => {
    const { records, drops } = aggregate([
      row({ 'Enterprise Size': 'Academic', CRN: 'RC000123' }),
      row({ 'Enterprise Size': 'Catapult' }),
      row({ 'Enterprise Size': '' }),
    ]);
    expect(records).toEqual([]);
    expect(drops.notACompany).toBe(3);
  });

  it('requires a valid Companies House number — no name fallback', () => {
    const { records, drops } = aggregate([row({ CRN: '' }), row({ CRN: 'Unknown' }), row({ CRN: 'CHAR.1234.5' })]);
    expect(records).toEqual([]);
    expect(drops.noCrn).toBe(3);
  });

  it('drops withdrawn participations but keeps finished ("Closed") ones', () => {
    const { records, drops } = aggregate([
      row({ 'Project Number': '1', 'Participant Withdrawn From Project': 'Withdrawn' }),
      row({ 'Project Number': '2', 'Participant Withdrawn From Project': 'Voluntary Withdrawal' }),
      row({ 'Project Number': '3', 'Project Status': 'Withdrawn' }),
      row({ 'Project Number': '4', 'Participant Withdrawn From Project': 'Closed', 'Project Status': 'Closed' }),
    ]);
    expect(drops.withdrawn).toBe(3);
    expect(records[0]!.rounds!.map((r) => r.externalId)).toEqual(['4:05002194']);
  });

  it('drops rows with no award, no date or no FX rate', () => {
    expect(aggregate([row({ 'Award Offered (£)': '0' })]).drops.noAward).toBe(1);
    expect(aggregate([row({ 'Project Start Date': '' })]).drops.noDate).toBe(1);
    expect(aggregate([row()], { usdPer: () => null }).drops.noFx).toBe(1);
  });

  it('aggregates one company across projects, newest participation supplying its facts', () => {
    const { records } = aggregate([
      row({ 'Project Number': '1', 'Project Start Date': '40544', 'Address Region': 'London' }),
      row({ 'Project Number': '2', 'Participant Name': 'ACME ROBOTICS LTD', 'Address Region': 'Scotland' }),
    ]);
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.company.name).toBe('Acme Robotics LTD');
    expect(r.company.hq).toBe('Scotland, United Kingdom');
    expect(r.company.description).toBe(
      "Acme Robotics LTD received 2 Innovate UK awards since 2011, published in UKRI's funded-projects dataset.",
    );
    // Newest first, like every other ladder.
    expect(r.rounds!.map((x) => x.date)).toEqual(['2021-02-01', '2011-01-01']);
  });

  it('sums a participant listed twice on one project instead of letting one row clobber the other', () => {
    const { records } = aggregate([row(), row({ 'Award Offered (£)': '75000' })]);
    expect(records[0]!.rounds).toHaveLength(1);
    expect(records[0]!.rounds![0]).toMatchObject({ amountLocal: 500_000, amountUsd: 625_000 });
  });

  it('records an Innovation Loan as Debt, which counts as raised', () => {
    const { records } = aggregate([
      row({ 'Project Number': '1', 'Innovate UK Product Type': 'Innovation Loans', 'Award Offered (£)': '1000000' }),
      row({ 'Project Number': '2' }),
    ]);
    const loan = records[0]!.rounds!.find((r) => r.externalId === '1:05002194')!;
    expect(loan).toMatchObject({ kind: 'Debt', name: 'Innovate UK innovation loan' });
    expect(records[0]!.company.totalRaisedUsd).toBe(1_250_000);
  });
});
