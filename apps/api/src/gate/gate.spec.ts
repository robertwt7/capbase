import { describe, it, expect, jest } from '@jest/globals';
import { DEFAULT_GATE_POLICY, canViewCompanyHistory, type GatePolicy, type ViewerAccess } from '@repo/api';

import {
  COMPANY_BLANKS,
  ROUND_BLANKS,
  directoryFilters,
  gateFields,
  gateRowFields,
  listAccess,
  listAccessFor,
  maskFields,
  publicRowsWhere,
  rowVisible,
  stubFor,
} from './gate';

const base = { unlockedUntil: null, admin: false, windowDays: 30 };
const signedOut: ViewerAccess = { ...base, unlocked: false, signedIn: false };
const locked: ViewerAccess = { ...base, unlocked: false, signedIn: true };
const unlocked: ViewerAccess = { ...base, unlocked: true, signedIn: true };
const admin: ViewerAccess = { ...base, unlocked: true, signedIn: true, admin: true };
const P = DEFAULT_GATE_POLICY;

const company = {
  slug: 'acme',
  oneLiner: 'What the company does.',
  description: 'The partner wrote this.',
  totalRaisedUsd: 9_000_000,
  lastValuationUsd: 40_000_000,
  industry: ['Software'],
  hq: 'Oslo',
  stage: 'Seed',
};

const withField = (field: string, audience: string, partnerAudience: string): GatePolicy =>
  ({
    ...P,
    fields: { ...P.fields, company: { ...P.fields.company, [field]: { audience, partnerAudience } } },
  }) as GatePolicy;

describe('gateFields under the default policy (the old partner rule)', () => {
  it('blanks partner fields for a signed-out viewer and lists them in `masked`', () => {
    const out = gateFields(
      'company',
      company,
      ['hq', 'totalRaisedUsd', 'lastValuationUsd', 'industry', 'notOnTheEntity'],
      signedOut,
      P,
      COMPANY_BLANKS,
    );
    expect(out).toMatchObject({ description: company.description, totalRaisedUsd: 0, lastValuationUsd: null, industry: [], hq: '' });
    expect((out as { masked?: string[] }).masked?.sort()).toEqual(['hq', 'industry', 'lastValuationUsd', 'totalRaisedUsd']);
    expect((out as { maskedUnlock?: object }).maskedUnlock).toEqual({
      hq: 'signIn',
      totalRaisedUsd: 'signIn',
      lastValuationUsd: 'signIn',
      industry: 'signIn',
    });
    // The input is never mutated.
    expect(company.hq).toBe('Oslo');
  });

  it.each([
    ['signed in, locked', locked],
    ['unlocked', unlocked],
    ['admin', admin],
  ])('is a no-op for a %s viewer', (_label, access) => {
    expect(gateFields('company', company, ['hq'], access, P, COMPANY_BLANKS)).toBe(company);
  });

  it('publishes partner prose while masking other partner fields', () => {
    const out = gateFields('company', company, ['oneLiner', 'description', 'hq'], signedOut, P, COMPANY_BLANKS);
    expect(out).toEqual({ ...company, hq: '', masked: ['hq'], maskedUnlock: { hq: 'signIn' } });
  });

  it('returns prose-only entities untouched without a masked list', () => {
    expect(gateFields('company', company, ['description'], signedOut, P, COMPANY_BLANKS)).toBe(company);
  });

  it('keeps the partner rule for a field outside the registry', () => {
    const fund = { id: 'f', managementFeePct: 2 };
    expect(gateFields('fund', fund, ['managementFeePct'], signedOut, P)).toEqual({
      id: 'f',
      managementFeePct: null,
      masked: ['managementFeePct'],
      maskedUnlock: { managementFeePct: 'signIn' },
    });
    expect(gateFields('fund', fund, ['managementFeePct'], locked, P)).toBe(fund);
  });

  it('merges into an existing masked list', () => {
    const out = maskFields({ a: 1, b: 2, masked: ['a'] }, ['b']);
    expect(out).toEqual({ a: 1, b: null, masked: ['a', 'b'] });
  });
});

describe('gateFields with overrides', () => {
  it('hides a field below its audience, whoever wrote it', () => {
    const p = withField('totalRaisedUsd', 'signedIn', 'signedIn');
    const out = gateFields('company', company, [], signedOut, p, COMPANY_BLANKS);
    expect(out).toMatchObject({ totalRaisedUsd: 0, masked: ['totalRaisedUsd'], maskedUnlock: { totalRaisedUsd: 'signIn' } });
    expect(gateFields('company', company, [], locked, p, COMPANY_BLANKS)).toBe(company);
  });

  it('says contribute when only contributors may see it', () => {
    const p = withField('stage', 'everyone', 'contributors');
    const out = gateFields('company', company, ['stage'], locked, p, COMPANY_BLANKS);
    expect(out).toMatchObject({ stage: '', masked: ['stage'], maskedUnlock: { stage: 'contribute' } });
    // A public value stays.
    expect(gateFields('company', company, [], locked, p, COMPANY_BLANKS)).toBe(company);
    expect(gateFields('company', company, ['stage'], unlocked, p, COMPANY_BLANKS)).toBe(company);
  });

  it('masks partner prose again when its partner audience is raised', () => {
    const p = withField('description', 'everyone', 'signedIn');
    const out = gateFields('company', company, ['description'], signedOut, p, COMPANY_BLANKS);
    expect(out).toMatchObject({ description: '', masked: ['description'] });
  });

  it('never hides anything from an admin', () => {
    const p = withField('stage', 'contributors', 'contributors');
    expect(gateFields('company', company, ['stage'], admin, p, COMPANY_BLANKS)).toBe(company);
  });
});

describe('gateRowFields', () => {
  const round = { id: 'r', name: 'Series A', amountUsd: 5 };

  it('masks partner-corrected columns below the section partner audience', () => {
    expect(gateRowFields(round, ['amountUsd'], signedOut, P, 'companyRounds', ROUND_BLANKS)).toEqual({
      ...round,
      amountUsd: 0,
      masked: ['amountUsd'],
      maskedUnlock: { amountUsd: 'signIn' },
    });
    expect(gateRowFields(round, ['amountUsd'], locked, P, 'companyRounds', ROUND_BLANKS)).toBe(round);
  });
});

describe('publicRowsWhere', () => {
  it('keeps NULL-source rows (contributions) while dropping partner rows', () => {
    expect(publicRowsWhere(signedOut, P, 'companyRounds')).toEqual({
      OR: [{ externalSource: null }, { externalSource: { not: 'PARTNER' } }],
    });
  });

  it('filters nothing once the section partner audience is met', () => {
    expect(publicRowsWhere(locked, P, 'companyRounds')).toEqual({});
    expect(publicRowsWhere(unlocked, P, 'companyRounds')).toEqual({});
    const open = { ...P, sections: { ...P.sections, companyRounds: { ...P.sections.companyRounds, partnerAudience: 'everyone' as const } } };
    expect(publicRowsWhere(signedOut, open, 'companyRounds')).toEqual({});
  });

  it('agrees with the in-memory check', () => {
    expect(rowVisible({ externalSource: null }, signedOut, P, 'fundMetrics')).toBe(true);
    expect(rowVisible({ externalSource: 'SEC_EDGAR' }, signedOut, P, 'fundMetrics')).toBe(true);
    expect(rowVisible({ externalSource: 'PARTNER' }, signedOut, P, 'fundMetrics')).toBe(false);
    expect(rowVisible({ externalSource: 'PARTNER' }, locked, P, 'fundMetrics')).toBe(true);
  });
});

describe('directoryFilters', () => {
  it('narrows a partner-gated filter signed out and locks nothing (the defaults)', () => {
    const dir = directoryFilters(P, 'company', signedOut, { stage: true, sector: false });
    expect(dir.use('stage')).toBe(true);
    expect(dir.and).toEqual([{ NOT: { partnerFields: { has: 'stage' } } }]);
    expect(dir.locked).toEqual({ filters: [], sorts: [], unlockBy: {} });
    expect(directoryFilters(P, 'company', locked, { stage: true }).and).toEqual([]);
  });

  it('ignores a filter on a hidden field and locks its sort', () => {
    const p = withField('stage', 'contributors', 'contributors');
    const dir = directoryFilters(p, 'company', locked, { stage: true });
    expect(dir.use('stage')).toBe(false);
    expect(dir.and).toEqual([]);
    expect(dir.locked).toEqual({ filters: ['stage'], sorts: [], unlockBy: { stage: 'contribute' } });

    const raised = withField('totalRaisedUsd', 'signedIn', 'signedIn');
    const sorted = directoryFilters(raised, 'company', signedOut, {});
    expect(sorted.sortLocked('raised')).toBe(true);
    expect(sorted.sortLocked('name')).toBe(false);
    expect(sorted.locked).toEqual({ filters: [], sorts: ['raised'], unlockBy: { raised: 'signIn' } });
  });

  it('drops a partner-only column filter rather than narrowing it', () => {
    const dir = directoryFilters(P, 'fund', signedOut, { status: true, strategy: true });
    expect(dir.use('status')).toBe(false);
    expect(dir.use('strategy')).toBe(true);
    expect(dir.and).toEqual([{ NOT: { partnerFields: { has: 'strategy' } } }]);
    expect(dir.locked.filters).toEqual(['status']);
    expect(directoryFilters(P, 'fund', locked, { status: true }).use('status')).toBe(true);
  });
});

describe('list access', () => {
  it('reads unlocked and admin off the role', () => {
    expect(listAccess(undefined, P)).toEqual({ ...signedOut, windowDays: 30 });
    expect(listAccess({ role: 'USER' }, P)).toMatchObject({ unlocked: false, signedIn: true, admin: false });
    expect(listAccess({ role: 'CONTRIBUTOR' }, P)).toMatchObject({ unlocked: true, admin: false });
    expect(listAccess({ role: 'ADMIN' }, P)).toMatchObject({ unlocked: true, admin: true });
  });

  it('looks a USER contribution up only while a contributors audience exists', async () => {
    const accessFor = jest.fn(async () => unlocked);
    const user = { id: 'u', role: 'USER' };
    await expect(listAccessFor(user, P, 'company', accessFor)).resolves.toMatchObject({ unlocked: false });
    expect(accessFor).not.toHaveBeenCalled();
    const p = withField('stage', 'contributors', 'contributors');
    await expect(listAccessFor(user, p, 'company', accessFor)).resolves.toBe(unlocked);
    await listAccessFor({ id: 'c', role: 'CONTRIBUTOR' }, p, 'company', accessFor);
    await listAccessFor(undefined, p, 'company', accessFor);
    expect(accessFor).toHaveBeenCalledTimes(1);
  });
});

describe('stubFor', () => {
  it('stubs a partner-only entity for signed-out viewers only', () => {
    expect(stubFor(true, signedOut)).toBe(true);
    expect(stubFor(true, locked)).toBe(false);
    expect(stubFor(false, signedOut)).toBe(false);
  });
});

describe('canViewCompanyHistory', () => {
  it.each([
    [undefined, false],
    [null, false],
    ['USER', false],
    ['CONTRIBUTOR', true],
    ['ADMIN', true],
  ] as const)('permits role %s: %s', (role, allowed) => {
    expect(canViewCompanyHistory(role)).toBe(allowed);
  });
});
