import { describe, expect, it } from '@jest/globals';

import { FxTable } from '../../util/fx';
import {
  PARTNER_SECTOR_MAP,
  cleanProse,
  companyStage,
  currencyCode,
  firmType,
  fundStatus,
  fundStrategy,
  normalizeEmail,
  normalizeLinkedIn,
  normalizePhone,
  oneLinerOf,
  partnerCountry,
  roundFor,
  toCommitment,
  toFund,
  toInvestorFirm,
  toMetric,
  toPerson,
  toRecord,
  toRound,
  type CompanyRow,
  type DealRow,
  type FirmRow,
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
