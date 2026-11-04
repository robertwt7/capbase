import { describe, expect, it } from '@jest/globals';

import { FxTable } from '../../util/fx';
import {
  FOCUS_RANGE_MAX_USD,
  PARTNER_SECTOR_MAP,
  cleanProse,
  companyFacts,
  companyStage,
  currencyCode,
  emptyFocusIssues,
  firmType,
  focusLabels,
  focusRange,
  fundStatus,
  fundStrategy,
  geographyLabels,
  millionsToUnits,
  normalizeEmail,
  normalizeLinkedIn,
  normalizePhone,
  oneLinerOf,
  partnerCountry,
  roundFor,
  toCommitment,
  toFirmFocus,
  toFirmFocusList,
  toFund,
  toFundMandate,
  toInvestorFirm,
  toMetric,
  toPerson,
  toRecord,
  toRound,
  type CompanyRow,
  type DealRow,
  type FirmFocusRow,
  type FirmRow,
  type FundMandateRow,
  type FundRow,
  type KeptFirm,
  type PersonRow,
} from './partner.parser';

// EUR→USD 1.10 and GBP→USD 1.25 from 2020 on; nothing before 1999 (the ECB's start).
const fx = FxTable.parse('Date,USD,GBP,\n2020-01-02,1.1000,0.8800,\n');

const firm = (over: Partial<FirmRow> = {}): FirmRow => ({
  firm_id: '501',
  name: 'Granite Peak Partners',
  role: 'manager',
  manager_firm_type: 'Private Equity Firm',
  lp_firm_type: null,
  country: 'US',
  city: 'Boston',
  website: 'www.granitepeak.example',
  year_established: 2004,
  about: 'Granite Peak is a <a href=x>venture</a> firm. It invests early.',
  aum_usd: 1_000_000_000,
  vc_fund_share: null,
  deal_count: 0,
  ...over,
});

const kept = new Map<string, KeptFirm>([
  ['501', { name: 'Granite Peak Partners', type: 'Venture' }],
  ['777', { name: 'State Pension Plan', type: 'Pension fund' }],
]);

describe('firmType', () => {
  it('types a manager by its fund mix: venture at ≥50% VC funds', () => {
    expect(firmType(firm({ vc_fund_share: 0.5 }))).toBe('Venture');
    expect(firmType(firm({ vc_fund_share: 0.49 }))).toBe('Private equity');
  });

  it('types a fundless manager with deals as venture (the deal extract is venture-only)', () => {
    expect(firmType(firm({ vc_fund_share: null, deal_count: 3 }))).toBe('Venture');
    expect(firmType(firm({ vc_fund_share: null, deal_count: 0 }))).toBe('Private equity');
  });

  it.each([
    ['Private Equity Fund of Funds Manager', 'Fund of funds'],
    ['Secondary Fund of Funds Manager', 'Fund of funds'],
    ['Hedge Fund Manager', 'Hedge fund'],
    ['Corporate Investor', 'Corporate'],
    ['Family Office - Single', 'Family office'],
    ['Family Office - Multi', 'Family office'],
    ['Public Pension Fund', 'Pension fund'],
    ['Private Sector Pension Fund', 'Pension fund'],
    ['Superannuation Scheme', 'Pension fund'],
    ['Endowment Plan', 'Endowment'],
    ['Foundation', 'Foundation'],
    ['Insurance Company', 'Insurance'],
    ['Bank', 'Bank'],
    ['Investment Bank', 'Bank'],
    ['Wealth Manager', 'Wealth manager'],
    ['Asset Manager', 'Asset manager'],
    ['Investment Trust', 'Asset manager'],
    ['Government Agency', 'Government'],
    ['Sovereign Wealth Fund', 'Sovereign wealth'],
    ['Private Debt Firm', 'Private equity'],
    ['Real Estate Firm (Investor)', 'Private equity'],
  ])('maps the LP firm type %s → %s', (raw, expected) => {
    expect(firmType(firm({ role: 'lp', manager_firm_type: null, lp_firm_type: raw }))).toBe(expected);
  });

  it.each(['Law Firm', 'Placement Agent', 'Investment Consultant', 'Advisory', 'Investor', 'Other', null])(
    'drops a firm that is not an investor (%s)',
    (raw) => {
      expect(firmType(firm({ role: 'lp', manager_firm_type: null, lp_firm_type: raw }))).toBeNull();
    },
  );

  it('reads the manager type first for a firm in both tables', () => {
    expect(
      firmType(firm({ role: 'both', manager_firm_type: 'Fund Manager', lp_firm_type: 'Bank', vc_fund_share: 1 })),
    ).toBe('Venture');
    expect(firmType(firm({ role: 'both', manager_firm_type: 'Advisory', lp_firm_type: 'Bank' }))).toBe('Bank');
  });
});

describe('text and places', () => {
  it('strips markup and keeps the anchor text', () => {
    expect(cleanProse('A <a href=https://x>linked</a> firm &amp; co.<br/>')).toBe('A linked firm & co.');
    expect(cleanProse('   ')).toBeNull();
  });

  it('takes the first sentence as the one-liner, capped at a word boundary', () => {
    expect(oneLinerOf('Acme builds robots. It is in Ohio.')).toBe('Acme builds robots.');
    const long = `${'word '.repeat(60)}end.`;
    const out = oneLinerOf(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(oneLinerOf(null)).toBe('');
  });

  it('does not end the one-liner on an abbreviation', () => {
    expect(oneLinerOf('Founded by Jane Doe, Oravel Stays Pvt. Ltd., d.b.a. OYO, runs homes. More.')).toBe(
      'Founded by Jane Doe, Oravel Stays Pvt. Ltd., d.b.a. OYO, runs homes.',
    );
    expect(oneLinerOf('Acme Inc. makes U.S. robots. Founded 2001.')).toBe('Acme Inc. makes U.S. robots.');
  });

  it('maps the partner’s own country spellings', () => {
    expect(partnerCountry('Hong Kong SAR - China')).toBe('HK');
    expect(partnerCountry('Taiwan - China')).toBe('TW');
    expect(partnerCountry('US')).toBe('US');
    expect(partnerCountry('UK')).toBe('GB');
    expect(partnerCountry('Kosovo')).toBeNull();
  });
});

describe('private contact details', () => {
  it('lowercases a well-formed email and rejects anything else', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
  });

  it('keeps a phone as published, requiring real digits', () => {
    expect(normalizePhone(' +1  617 555 0100 ')).toBe('+1 617 555 0100');
    expect(normalizePhone('+44 (0)20')).toBeNull();
  });

  it('keeps only personal LinkedIn profiles, canonicalised', () => {
    expect(normalizeLinkedIn('linkedin.com/in/jane-doe?trk=x')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(normalizeLinkedIn('https://uk.linkedin.com/pub/jane/1/2/3')).toBe('https://www.linkedin.com/pub/jane');
    expect(normalizeLinkedIn('https://www.linkedin.com/company/acme')).toBeNull();
    expect(normalizeLinkedIn('https://evil.example/in/jane')).toBeNull();
    expect(normalizeLinkedIn('https://linkedin.com.evil.example/in/jane')).toBeNull();
  });

  const person = (over: Partial<PersonRow> = {}): PersonRow => ({
    contact_id: 'C1',
    firm_id: '501',
    name: ' Jane Doe ',
    job_title: 'Managing Partner',
    email: 'Jane@Example.com',
    phone: '+1 617 555 0100',
    linkedin: 'www.linkedin.com/in/jane',
    ...over,
  });

  it('puts contact values in `contact` only — never in role, title or the public link', () => {
    const p = toPerson(person(), 2026)!;
    expect(p).toMatchObject({
      externalId: 'C1:501',
      name: 'Jane Doe',
      role: 'Managing Partner',
      title: 'Managing Partner',
      kind: null,
      since: 2026,
      linkedinUrl: null,
      identifiers: [{ scheme: 'PARTNER', value: 'C1' }],
      identifierOnly: true,
    });
    expect(p.contact).toEqual({
      email: 'jane@example.com',
      phone: '+1 617 555 0100',
      linkedinUrl: 'https://www.linkedin.com/in/jane',
    });
    const publicPart = JSON.stringify({ ...p, contact: undefined });
    expect(publicPart).not.toMatch(/example\.com|555 0100|linkedin\.com/);
  });

  it('omits `contact` when every value is empty or invalid, and names a blank title Staff', () => {
    const p = toPerson(person({ email: 'x', phone: null, linkedin: 'https://x.example', job_title: null }), 2026)!;
    expect(p.contact).toBeUndefined();
    expect(p.role).toBe('Staff');
    expect(p.title).toBeNull();
  });

  it('drops a nameless contact', () => {
    expect(toPerson(person({ name: '  ' }), 2026)).toBeNull();
  });
});

describe('toInvestorFirm', () => {
  it('maps the firm with its identifier, place, domain and people', () => {
    const f = toInvestorFirm(firm(), 'Venture', [], 2026);
    expect(f).toMatchObject({
      externalId: '501',
      name: 'Granite Peak Partners',
      type: 'Venture',
      hq: 'Boston, US',
      countryCode: 'US',
      websiteUrl: 'https://www.granitepeak.example',
      domain: 'granitepeak.example',
      description: 'Granite Peak is a venture firm. It invests early.',
      foundedYear: 2004,
      assetsUsd: 1_000_000_000,
      identifiers: [{ scheme: 'PARTNER', value: '501' }],
      people: [],
    });
  });

  it('never uses a platform host as the domain', () => {
    expect(toInvestorFirm(firm({ website: 'https://www.linkedin.com/company/x' }), 'Venture', [], 2026).domain).toBeNull();
  });

  it('carries no focus when none is offered', () => {
    expect(toInvestorFirm(firm(), 'Venture', [], 2026).focus).toBeUndefined();
    expect(toInvestorFirm(firm(), 'Venture', [], 2026, []).focus).toBeUndefined();
  });

  it('carries the focus roles it is given', () => {
    const roles = toFirmFocusList([focusRow()], '2026-10-14', emptyFocusIssues());
    expect(toInvestorFirm(firm(), 'Venture', [], 2026, roles).focus).toEqual(roles);
  });
});

const focusRow = (over: Partial<FirmFocusRow> = {}): FirmFocusRow => ({
  firm_id: '501',
  role: 'manager',
  reported_on: '2025-06-30',
  stages: ['Seed', 'Initial Round', 'Round B,C,D...'],
  main_strategy: 'Venture Capital (All Stages)',
  strategies: ['Early Stage', 'Expansion / Late Stage'],
  industries: ['Software', 'Healthcare'],
  verticals: ['Fintech'],
  geographies: ['US', 'Europe'],
  range_min_usd_mn: 1,
  range_max_usd_mn: 10,
  range_min_local_mn: null,
  range_max_local_mn: null,
  range_currency: 'USD',
  ...over,
});

describe('investor focus', () => {
  describe('focusLabels', () => {
    it('trims, drops blanks and junk, de-duplicates case-insensitively, keeps source order', () => {
      expect(
        focusLabels([' Software ', '', null, 'Unknown', 'other', 'N/A', '--', 'None', 'software', 'Healthcare', 'Fintech']),
      ).toEqual(['Software', 'Healthcare', 'Fintech']);
    });

    it('keeps the first spelling of a duplicate', () => {
      expect(focusLabels(['FinTech', 'Fintech', 'fintech'])).toEqual(['FinTech']);
    });

    it('keeps a label that contains commas whole', () => {
      expect(focusLabels(['Round B,C,D...'])).toEqual(['Round B,C,D...']);
    });

    it('drops an over-long label and returns [] for null', () => {
      expect(focusLabels(['x'.repeat(81), 'Seed'])).toEqual(['Seed']);
      expect(focusLabels(null)).toEqual([]);
    });
  });

  describe('millionsToUnits', () => {
    it('converts millions to whole units exactly once', () => {
      expect(millionsToUnits(1.5)).toEqual({ value: 1_500_000, invalid: false });
      expect(millionsToUnits(22.75)).toEqual({ value: 22_750_000, invalid: false });
      expect(millionsToUnits(0.1)).toEqual({ value: 100_000, invalid: false });
    });

    it('reads 0 as no bound, negative and non-finite as invalid', () => {
      expect(millionsToUnits(0)).toEqual({ value: null, invalid: false });
      expect(millionsToUnits(null)).toEqual({ value: null, invalid: false });
      expect(millionsToUnits(-999)).toEqual({ value: null, invalid: true });
      expect(millionsToUnits(Number.NaN)).toEqual({ value: null, invalid: true });
    });
  });

  describe('focusRange', () => {
    it('keeps both bounds', () => {
      expect(focusRange(focusRow())).toEqual({
        range: { minUsd: 1_000_000, maxUsd: 10_000_000, currency: 'USD', minLocal: null, maxLocal: null },
      });
    });

    it('keeps a one-sided range ("From" / "Up to")', () => {
      expect(focusRange(focusRow({ range_max_usd_mn: null })).range).toMatchObject({ minUsd: 1_000_000, maxUsd: null });
      expect(focusRange(focusRow({ range_min_usd_mn: 0 })).range).toMatchObject({ minUsd: null, maxUsd: 10_000_000 });
    });

    it('drops 0/0 without an issue', () => {
      expect(focusRange(focusRow({ range_min_usd_mn: 0, range_max_usd_mn: 0 }))).toEqual({ range: null });
    });

    it('drops an inverted range', () => {
      expect(focusRange(focusRow({ range_min_usd_mn: 20, range_max_usd_mn: 5 }))).toEqual({
        range: null,
        issue: 'range-inverted',
      });
    });

    it('drops an implausible range (a unit error)', () => {
      expect(focusRange(focusRow({ range_max_usd_mn: 5_687_059.32 }))).toEqual({
        range: null,
        issue: 'range-implausible',
      });
      expect(focusRange(focusRow({ range_max_usd_mn: FOCUS_RANGE_MAX_USD / 1e6 })).range).not.toBeNull();
    });

    it('drops both bounds when one is invalid', () => {
      expect(focusRange(focusRow({ range_min_usd_mn: -999 }))).toEqual({ range: null, issue: 'amount-invalid' });
    });

    it('keeps native bounds for a non-USD firm', () => {
      expect(
        focusRange(focusRow({ range_currency: 'EUR', range_min_local_mn: 0.9, range_max_local_mn: 9 })).range,
      ).toEqual({ minUsd: 1_000_000, maxUsd: 10_000_000, currency: 'EUR', minLocal: 900_000, maxLocal: 9_000_000 });
    });

    it('reads RMB as CNY, and a blank currency as USD-only', () => {
      expect(
        focusRange(focusRow({ range_currency: 'RMB', range_min_local_mn: 7, range_max_local_mn: 70 })).range,
      ).toMatchObject({ currency: 'CNY', minLocal: 7_000_000, maxLocal: 70_000_000 });
      expect(
        focusRange(focusRow({ range_currency: ' ', range_min_local_mn: 7, range_max_local_mn: 70 })).range,
      ).toEqual({ minUsd: 1_000_000, maxUsd: 10_000_000, currency: 'USD', minLocal: null, maxLocal: null });
    });

    it('keeps no local bounds for a USD firm', () => {
      expect(
        focusRange(focusRow({ range_currency: 'USD', range_min_local_mn: 1, range_max_local_mn: 10 })).range,
      ).toMatchObject({ currency: 'USD', minLocal: null, maxLocal: null });
    });

    it('falls back to USD-only when the local bounds do not line up', () => {
      expect(
        focusRange(focusRow({ range_currency: 'EUR', range_min_local_mn: null, range_max_local_mn: 9 })).range,
      ).toEqual({ minUsd: 1_000_000, maxUsd: 10_000_000, currency: 'USD', minLocal: null, maxLocal: null });
    });
  });

  describe('toFirmFocus', () => {
    it('maps a manager with everything', () => {
      expect(toFirmFocus(focusRow(), '2026-10-14')).toEqual({
        focus: {
          role: 'manager',
          stages: ['Seed', 'Initial Round', 'Round B,C,D...'],
          mainStrategy: 'Venture Capital (All Stages)',
          strategies: ['Early Stage', 'Expansion / Late Stage'],
          industries: ['Software', 'Healthcare'],
          verticals: ['Fintech'],
          geographies: ['US', 'Europe'],
          rangeMinUsd: 1_000_000,
          rangeMaxUsd: 10_000_000,
          rangeCurrency: 'USD',
          rangeMinLocal: null,
          rangeMaxLocal: null,
          reportedOn: '2025-06-30',
          snapshotDate: '2026-10-14',
        },
        issues: [],
      });
    });

    it('ignores stages and main strategy on an LP row', () => {
      const { focus } = toFirmFocus(focusRow({ role: 'lp' }), '2026-10-14');
      expect(focus).toMatchObject({ role: 'lp', stages: [], mainStrategy: null, industries: ['Software', 'Healthcare'] });
    });

    it('falls back to the snapshot date', () => {
      expect(toFirmFocus(focusRow({ reported_on: null }), '2026-10-14').focus?.reportedOn).toBe('2026-10-14');
    });

    it('is null when nothing usable is stated', () => {
      const r = toFirmFocus(
        focusRow({
          stages: ['Unknown'],
          main_strategy: null,
          strategies: null,
          industries: [''],
          verticals: null,
          geographies: ['Other'],
          range_min_usd_mn: 0,
          range_max_usd_mn: 0,
        }),
        '2026-10-14',
      );
      expect(r).toEqual({ focus: null, issues: ['labels-dropped'] });
    });

    it('reads a junk main strategy as null', () => {
      expect(toFirmFocus(focusRow({ main_strategy: 'Unknown' }), '2026-10-14').focus?.mainStrategy).toBeNull();
    });

    it('tallies issues across a firm', () => {
      const tally = emptyFocusIssues();
      const roles = toFirmFocusList(
        [focusRow({ range_min_usd_mn: 20, range_max_usd_mn: 5 }), focusRow({ role: 'lp', range_min_usd_mn: -999 })],
        '2026-10-14',
        tally,
      );
      expect(roles.map((r) => r.role)).toEqual(['manager', 'lp']);
      expect(tally).toEqual({ 'amount-invalid': 1, 'range-implausible': 0, 'range-inverted': 1, 'labels-dropped': 0 });
    });
  });
});

describe('funds', () => {
  it.each([
    ['Closed', 'Closed'],
    ['Currently Closed', 'Closed'],
    ['Raising', 'Raising'],
    ['Open to Investment/Raising', 'Raising'],
    ['First Close', 'First close'],
    ['Second Close', 'Second close'],
    ['Third Close', 'Later close'],
    ['Sixth Close', 'Later close'],
    ['Evergreen', 'Evergreen'],
    ['Semi-Open Ended', 'Evergreen'],
    ['Liquidated', 'Liquidated'],
    ['Open-Ended (Liquidated)', 'Liquidated'],
    ['Announced', 'Announced'],
    ['Estimated', 'Announced'],
    ['Never Launched', 'skip'],
    ['Abandoned', 'skip'],
    ['Listed', null],
    ['Unknown', null],
  ])('maps status %s → %s', (raw, expected) => {
    expect(fundStatus(raw)).toBe(expected);
  });

  it.each([
    ['Venture Capital', 'Venture capital'],
    ['Private Equity', 'Private equity'],
    ['Real Estate', 'Real estate'],
    ['Hedge Funds', 'Hedge fund'],
    ['Private Debt', 'Other'],
    ['Infrastructure', 'Other'],
    ['Natural Resources', 'Other'],
    ['Multi', 'Other'],
  ])('maps asset class %s → %s', (raw, expected) => {
    expect(fundStrategy(raw)).toBe(expected);
  });

  const fund = (over: Partial<FundRow> = {}): FundRow => ({
    fund_id: 'F1',
    manager_id: '501',
    name: 'Granite Peak Fund II ',
    status: 'Closed',
    asset_class: 'Venture Capital',
    vintage: 2017,
    currency: 'USD',
    size_usd: 400_000_000,
    target_usd: 350_000_000,
    hard_cap_usd: null,
    launch_date: '2016-09-01',
    latest_close_date: '2017-03-31',
    final_close_date: '2017-06-30',
    mgmt_fee_pct: 2,
    carry_pct: 20,
    hurdle_pct: null,
    irr_net_min: 15,
    irr_net_max: 20,
    irr_gross_min: null,
    irr_gross_max: null,
    region_focus: 'North America',
    city: null,
    country: 'US',
    ...over,
  });

  it('maps a fund with its manager reference, terms and dates', () => {
    expect(toFund(fund(), kept)).toMatchObject({
      externalId: 'F1',
      name: 'Granite Peak Fund II',
      manager: { externalId: '501', identifier: { scheme: 'PARTNER', value: '501' } },
      strategy: 'Venture capital',
      status: 'Closed',
      vintageYear: 2017,
      targetUsd: 350_000_000,
      closedUsd: 400_000_000,
      hardCapUsd: null,
      launchDate: '2016-09-01',
      finalCloseDate: '2017-06-30',
      managementFeePct: 2,
      carriedInterestPct: 20,
      hurdleRatePct: null,
      targetIrrNetMinPct: 15,
      regionFocus: 'North America',
      hq: 'US',
    });
  });

  it('drops a never-launched fund and a fund whose manager was dropped', () => {
    expect(toFund(fund({ status: 'Never Launched' }), kept)).toBeNull();
    expect(toFund(fund({ manager_id: 'law-firm' }), kept)).toBeNull();
  });

  it('keeps an unparseable or absurd percentage null, never 0', () => {
    expect(toFund(fund({ mgmt_fee_pct: null, carry_pct: 250 }), kept)).toMatchObject({
      managementFeePct: null,
      carriedInterestPct: null,
    });
  });

  it('carries no mandate unless one is given, and attaches one that is', () => {
    expect(toFund(fund(), kept)).not.toHaveProperty('mandate');
    expect(toFund(fund(), kept, null)).not.toHaveProperty('mandate');
    const { mandate } = toFundMandate(mandateRow(), '2026-10-14');
    expect(toFund(fund(), kept, mandate)!.mandate).toBe(mandate);
  });
});

const mandateRow = (over: Partial<FundMandateRow> = {}): FundMandateRow => ({
  fund_id: 'F1',
  detailed_strategy: 'Early Stage: Seed',
  industries: ['Software', 'Automobiles, Other Vehicles & Parts', 'Diversified'],
  verticals: ['Fintech'],
  geographic_focus: ['North America'],
  geographic_exposure: ['North America', 'Europe', 'Other'],
  domicile: 'Delaware',
  structure: 'Commingled',
  legal_structure: 'Limited Partnership',
  ...over,
});

describe('fund mandate', () => {
  describe('geographyLabels', () => {
    it('splits a ; list nested in one element', () => {
      expect(geographyLabels(['North America; Europe; Global', 'Asia'])).toEqual([
        'North America',
        'Europe',
        'Global',
        'Asia',
      ]);
    });

    it('collapses the doubled SAR suffix, then de-duplicates it against the correct label', () => {
      expect(geographyLabels(['Hong Kong SAR - China SAR - China', 'Hong Kong SAR - China'])).toEqual([
        'Hong Kong SAR - China',
      ]);
    });

    it('drops Other and keeps Global', () => {
      expect(geographyLabels(['Other', 'Global'])).toEqual(['Global']);
    });

    it('reads null as nothing', () => {
      expect(geographyLabels(null)).toEqual([]);
      expect(geographyLabels([null])).toEqual([]);
    });
  });

  describe('toFundMandate', () => {
    it('cleans a full row and dates it at the snapshot', () => {
      expect(toFundMandate(mandateRow(), '2026-10-14')).toEqual({
        mandate: {
          detailedStrategy: 'Early Stage: Seed',
          // A label containing commas stays whole; Diversified is a statement.
          industries: ['Software', 'Automobiles, Other Vehicles & Parts', 'Diversified'],
          verticals: ['Fintech'],
          geographicFocus: ['North America'],
          geographicExposure: ['North America', 'Europe'],
          domicile: 'Delaware',
          structure: 'Commingled',
          legalStructure: 'Limited Partnership',
          reportedOn: '2026-10-14',
        },
        issues: ['labels-dropped'],
      });
    });

    it('drops a fund structure misfiled as the legal structure, keeping the structure', () => {
      const { mandate, issues } = toFundMandate(
        mandateRow({ structure: 'Commingled', legal_structure: 'Commingled', geographic_exposure: null }),
        '2026-10-14',
      );
      expect(mandate).toMatchObject({ structure: 'Commingled', legalStructure: null });
      expect(issues).toEqual(['legal-misfiled']);
    });

    it('keeps a US-state domicile as published', () => {
      expect(toFundMandate(mandateRow({ domicile: ' Delaware ' }), '2026-10-14').mandate!.domicile).toBe('Delaware');
    });

    it('is null when nothing usable is left', () => {
      const empty = mandateRow({
        detailed_strategy: 'Unknown',
        industries: [],
        verticals: null,
        geographic_focus: ['Other'],
        geographic_exposure: null,
        domicile: ' ',
        structure: null,
        legal_structure: null,
      });
      expect(toFundMandate(empty, '2026-10-14')).toEqual({ mandate: null, issues: ['labels-dropped'] });
    });
  });
});

describe('deals', () => {
  it.each([
    ['Series A', 'Series A', 'Equity', false],
    ['Series L', 'Series L', 'Equity', false],
    ['Seed', 'Seed', 'Equity', false],
    ['Angel', 'Angel', 'Equity', false],
    ['PIPE', 'PIPE', 'Equity', false],
    ['Pre-IPO', 'Pre-IPO', 'Equity', false],
    ['Growth Capital/Expansion', 'Growth', 'Equity', false],
    ['Venture Debt', 'Venture debt', 'Debt', false],
    ['Grant', 'Grant', 'Grant', false],
    ['Unspecified Round', 'Undisclosed round', 'Equity', true],
    [null, 'Undisclosed round', 'Equity', true],
  ])('maps stage %s → %s (%s)', (raw, name, kind, generic) => {
    expect(roundFor(raw)).toEqual({ name, kind, generic });
  });

  it.each(['Merger', 'Add-on', 'Secondary Stock Purchase'])('skips %s (not primary capital)', (raw) => {
    expect(roundFor(raw)).toBeNull();
  });

  it('maps RMB to CNY', () => {
    expect(currencyCode('RMB')).toBe('CNY');
    expect(currencyCode(' eur ')).toBe('EUR');
    expect(currencyCode('')).toBeNull();
  });

  const deal = (over: Partial<DealRow> = {}): DealRow => ({
    deal_id: 'D1',
    company_id: 'PC1',
    deal_date: '2021-03-10',
    stage: 'Series A',
    status: 'Completed',
    currency: 'USD',
    size_local: 10_000_000,
    size_usd: 10_000_000,
    ...over,
  });

  it('converts a non-USD deal at the ECB rate on its date', () => {
    expect(toRound(deal({ currency: 'EUR', size_local: 10_000_000, size_usd: 11_900_000 }), [], kept, fx)).toMatchObject({
      currency: 'EUR',
      amountLocal: 10_000_000,
      amountUsd: 11_000_000,
    });
  });

  it('falls back to the partner’s USD figure when the ECB has no rate', () => {
    expect(
      toRound(deal({ deal_date: '1997-05-01', currency: 'EUR', size_local: 1_000_000, size_usd: 1_200_000 }), [], kept, fx),
    ).toMatchObject({ amountUsd: 1_200_000 });
    expect(toRound(deal({ currency: 'XYZ', size_local: 5, size_usd: 7 }), [], kept, fx)).toMatchObject({ amountUsd: 7 });
  });

  it('writes an undisclosed amount as 0, and a blank currency with a USD figure as USD', () => {
    const r = toRound(deal({ currency: null, size_local: null, size_usd: null, stage: 'Unspecified Round' }), [], kept, fx)!;
    expect(r).toMatchObject({ amountUsd: 0, name: 'Undisclosed round', genericName: true });
    expect(r.currency).toBeUndefined();
    expect(toRound(deal({ currency: null, size_local: null, size_usd: 3_000_000 }), [], kept, fx)).toMatchObject({
      amountUsd: 3_000_000,
    });
  });

  it('attaches only investors that survived the type mapping', () => {
    const r = toRound(deal(), ['501', 'law-firm', '501'], kept, fx)!;
    expect(r.investors).toEqual([{ externalId: '501', identifier: { scheme: 'PARTNER', value: '501' } }]);
  });

  it('skips an incomplete or undated deal', () => {
    expect(toRound(deal({ status: 'Announced' }), [], kept, fx)).toBeNull();
    expect(toRound(deal({ deal_date: null }), [], kept, fx)).toBeNull();
  });

  it('takes the company stage from the latest deal that names one', () => {
    expect(companyStage([deal({ stage: 'Seed', deal_date: '2019-01-01' }), deal({ stage: 'Series B', deal_date: '2022-01-01' })])).toBe('Series B');
    expect(companyStage([deal({ stage: 'Series G' })])).toBe('Late stage');
    expect(companyStage([deal({ stage: 'PIPE' })])).toBe('Public');
    expect(companyStage([deal({ stage: 'Series C', deal_date: '2020-01-01' }), deal({ stage: 'Unspecified Round', deal_date: '2023-01-01' })])).toBe('Series C');
    expect(companyStage([deal({ stage: null, size_usd: 1_000_000 })])).toBe('Seed');
    // No deal names a stage: the Form D amount banding on the largest deal.
    expect(companyStage([deal({ stage: 'Unspecified Round', size_usd: 589_000_000 })])).toBe('Late stage');
    expect(companyStage([deal({ stage: null, size_usd: null })])).toBe('Seed');
  });

  it('maps every partner industry to a canonical sector', () => {
    expect(PARTNER_SECTOR_MAP['Software']).toBe('Technology');
    expect(PARTNER_SECTOR_MAP['Renewable Energy']).toBe('Climate');
    expect(PARTNER_SECTOR_MAP['Heating, Cooling & Ventilation Equipment and Services']).toBe('Industrials');
    expect(PARTNER_SECTOR_MAP['Automobiles, Other Vehicles & Parts']).toBe('Transport');
  });
});

describe('toRecord', () => {
  const company = (over: Partial<CompanyRow> = {}): CompanyRow => ({
    company_id: 'PC1',
    name: 'Acme Robotics',
    country: 'US',
    city: 'Austin',
    website: 'acme.example',
    industry: 'Software',
    verticals: null,
    about: 'Acme builds robots. It is based in Texas.',
    status: 'Active',
    ...over,
  });
  const deals: DealRow[] = [
    { deal_id: 'D1', company_id: 'PC1', deal_date: '2020-01-10', stage: 'Seed', status: 'Completed', currency: 'USD', size_local: 2_000_000, size_usd: 2_000_000 },
    { deal_id: 'D2', company_id: 'PC1', deal_date: '2022-05-01', stage: 'Series A', status: 'Completed', currency: 'USD', size_local: null, size_usd: null },
    { deal_id: 'D3', company_id: 'PC1', deal_date: '2023-01-01', stage: 'Merger', status: 'Completed', currency: null, size_local: null, size_usd: null },
    { deal_id: 'D4', company_id: 'PC1', deal_date: '2024-01-01', stage: 'Grant', status: 'Completed', currency: 'USD', size_local: 50_000, size_usd: 50_000 },
  ];
  const edges = new Map([
    ['D1', ['501']],
    ['D2', ['501', '777', 'law-firm']],
  ]);

  it('maps the company, its rounds and one holding per firm', () => {
    const r = toRecord(company(), deals, edges, kept, fx)!;
    expect(r).toMatchObject({
      source: 'PARTNER',
      companyExternalId: 'PC1',
      roundDedup: 'enrich',
      company: {
        name: 'Acme Robotics',
        hq: 'Austin, US',
        countryCode: 'US',
        websiteUrl: 'https://acme.example',
        domain: 'acme.example',
        primarySector: 'Technology',
        industry: ['Software'],
        stage: 'Series A',
        totalRaisedUsd: 2_000_000, // the grant is not a raise
        oneLiner: 'Acme builds robots.',
        operatingStatus: 'Active',
        identifiers: [{ scheme: 'PARTNER', value: 'PC1' }],
      },
    });
    expect(r.rounds!.map((x) => x.externalId)).toEqual(['D1', 'D2', 'D4']);
    expect(r.investors).toEqual([
      {
        externalId: 'PC1:501',
        investorExternalId: '501',
        investorIdentifier: { scheme: 'PARTNER', value: '501' },
        name: 'Granite Peak Partners',
        type: 'Venture',
        firstRound: 'Seed',
        rounds: 2,
        onlyIfKnown: true,
      },
      {
        externalId: 'PC1:777',
        investorExternalId: '777',
        investorIdentifier: { scheme: 'PARTNER', value: '777' },
        name: 'State Pension Plan',
        type: 'Pension fund',
        firstRound: 'Series A',
        rounds: 1,
        onlyIfKnown: true,
      },
    ]);
  });

  it('always supplies copy, so a created row never gets the SEC placeholder', () => {
    const r = toRecord(company({ about: null }), deals, edges, kept, fx)!;
    expect(r.company.oneLiner).toBe('');
    expect(r.company.description).toBe('');
  });

  it('leaves an exited company’s operating status unknown', () => {
    expect(toRecord(company({ status: 'Realised' }), deals, edges, kept, fx)!.company.operatingStatus).toBeNull();
  });

  it('imports nothing for an abandoned company, or one with no surviving deal', () => {
    expect(toRecord(company({ status: 'Abandoned' }), deals, edges, kept, fx)).toBeNull();
    expect(toRecord(company(), [deals[2]!], edges, kept, fx)).toBeNull();
  });
  it('states the same facts companyFacts does', () => {
    const row = company({ verticals: 'Robotics; AI' });
    const r = toRecord(row, deals, edges, kept, fx)!;
    const facts = companyFacts(row);
    expect(r.company.industry).toEqual(facts.industry);
    expect(r.company.hq).toBe(facts.hq);
    expect(r.company.countryCode).toBe(facts.countryCode);
  });
});

describe('companyFacts', () => {
  const row = (over: Partial<CompanyRow> = {}): CompanyRow => ({
    company_id: 'PC1',
    name: 'Acme Robotics',
    country: 'US',
    city: 'Austin',
    website: null,
    industry: 'Software',
    verticals: null,
    about: null,
    status: 'Active',
    ...over,
  });

  it('merges the industry with the verticals, trimmed and de-duplicated', () => {
    expect(companyFacts(row({ verticals: ' AI ; Software,Robotics, ' })).industry).toEqual([
      'Software',
      'AI',
      'Robotics',
    ]);
  });

  it('handles absent labels and places', () => {
    expect(companyFacts(row({ industry: null, verticals: null, city: null, country: null }))).toEqual({
      industry: [],
      hq: 'Undisclosed',
      countryCode: null,
    });
  });

  it('places a company by city and country', () => {
    expect(companyFacts(row())).toEqual({ industry: ['Software'], hq: 'Austin, US', countryCode: 'US' });
  });
});

describe('commitments and metrics', () => {
  it('converts a commitment at the vintage mid-year rate, keyed fund:firm', () => {
    const c = toCommitment(
      { fund_id: 'F1', firm_id: '777', amount_local: 20_000_000, fund_name: 'Fund II', manager_id: '501', fund_currency: 'EUR', vintage: 2021 },
      kept,
      fx,
    )!;
    expect(c).toEqual({
      externalId: 'F1:777',
      fund: { externalId: 'F1', name: 'Fund II', manager: { externalId: '501', identifier: { scheme: 'PARTNER', value: '501' } } },
      investor: { externalId: '777', identifier: { scheme: 'PARTNER', value: '777' } },
      currency: 'EUR',
      amountLocal: 20_000_000,
      amountUsd: 22_000_000,
    });
  });

  it('keeps an undisclosed commitment with null amounts, and a USD one without a local figure', () => {
    const base = { fund_id: 'F1', firm_id: '777', fund_name: 'Fund II', manager_id: '501', vintage: 2021 };
    expect(toCommitment({ ...base, amount_local: null, fund_currency: 'EUR' }, kept, fx)).toMatchObject({
      amountLocal: null,
      amountUsd: null,
    });
    expect(toCommitment({ ...base, amount_local: 5, fund_currency: 'USD' }, kept, fx)).toMatchObject({
      currency: 'USD',
      amountLocal: null,
      amountUsd: 5,
    });
  });

  it('drops a commitment from a firm that is not an investor (the cascade)', () => {
    expect(
      toCommitment({ fund_id: 'F1', firm_id: 'law-firm', amount_local: 1, fund_name: 'F', manager_id: '501', fund_currency: 'USD', vintage: 2020 }, kept, fx),
    ).toBeNull();
  });

  it('converts metric local figures at the as-at rate', () => {
    expect(
      toMetric(
        { fund_id: 'F1', as_at: '2024-06-30', dry_powder_local: 10, aum_usd: 99, unrealized_local: null, fund_name: 'F', manager_id: '501', fund_currency: 'GBP' },
        fx,
      ),
    ).toEqual({
      fund: { externalId: 'F1', name: 'F', manager: { externalId: '501', identifier: { scheme: 'PARTNER', value: '501' } } },
      asAt: '2024-06-30',
      aumUsd: 99,
      dryPowderUsd: 13,
      unrealizedUsd: null,
    });
  });
});
