import type { ViewerAccess } from './contributions';
import {
  DEFAULT_GATE_POLICY,
  GATED_SECTION_KEYS,
  SECTION_REGISTRY,
  crawlerView,
  fieldGate,
  fieldUnlockBy,
  gateView,
  meets,
  needsContributionLookup,
  resolveGatePolicy,
  sectionLimit,
  sectionPartnerRows,
  sectionView,
  validateFieldPolicy,
  validateSectionPolicy,
  validateWindowDays,
  type GatedSection,
  type GatePolicy,
  type SectionPolicy,
} from './visibility';

const base = { unlockedUntil: null, admin: false, windowDays: 30 };
const signedOut: ViewerAccess = { ...base, unlocked: false, signedIn: false };
const locked: ViewerAccess = { ...base, unlocked: false, signedIn: true };
const unlocked: ViewerAccess = { ...base, unlocked: true, signedIn: true };
const admin: ViewerAccess = { ...base, unlocked: true, signedIn: true, admin: true };

/** The hardcoded table this policy replaced (signed out / signed in / unlocked). */
const OLD_TIERS: Record<GatedSection, 'open' | 'members' | 'contributors'> = {
  companyRounds: 'members',
  companyDiversity: 'members',
  companyAcquisitions: 'members',
  companyExits: 'members',
  companyInvestors: 'open',
  companyPeople: 'open',
  companyTechnologies: 'open',
  companyApps: 'open',
  investorPortfolio: 'open',
  investorPeople: 'open',
  investorFunds: 'open',
  investorCommitments: 'members',
  investorFocus: 'members',
  fundCommitments: 'members',
  fundMetrics: 'members',
  fundTerms: 'contributors',
  fundMandate: 'members',
  personRoles: 'open',
};
const OLD_LIMITS = { open: [2, 2, Infinity], members: [0, 2, Infinity], contributors: [0, 0, Infinity] };

const withSection = (section: GatedSection, p: Partial<SectionPolicy>): GatePolicy => ({
  ...DEFAULT_GATE_POLICY,
  sections: { ...DEFAULT_GATE_POLICY.sections, [section]: { ...DEFAULT_GATE_POLICY.sections[section], ...p } },
});
const withField = (entity: 'company', field: string, p: Partial<GatePolicy['fields']['company'][string]>): GatePolicy => ({
  ...DEFAULT_GATE_POLICY,
  fields: {
    ...DEFAULT_GATE_POLICY.fields,
    company: { ...DEFAULT_GATE_POLICY.fields.company, [field]: { ...DEFAULT_GATE_POLICY.fields.company[field]!, ...p } },
  },
});

describe('defaults', () => {
  it('cover every section of the old table, and no other', () => {
    expect([...GATED_SECTION_KEYS].sort()).toEqual(Object.keys(OLD_TIERS).sort());
  });

  it.each(Object.entries(OLD_TIERS))('%s reproduces its old %s tier', (section, tier) => {
    const limits = [signedOut, locked, unlocked].map((a) => sectionLimit(DEFAULT_GATE_POLICY, section as GatedSection, a));
    // A block is read as all-or-nothing (limit > 0), never counted: its ≤ 2 rows
    // were "a preview of 2" before and are "full" now — the same block.
    if (SECTION_REGISTRY[section as GatedSection].kind === 'block') {
      expect(limits.map((n) => n > 0)).toEqual(OLD_LIMITS[tier].map((n) => n > 0));
    } else {
      expect(limits).toEqual(OLD_LIMITS[tier]);
    }
  });

  it('investorFocus is hidden / full / full', () => {
    expect([signedOut, locked, unlocked].map((a) => sectionLimit(DEFAULT_GATE_POLICY, 'investorFocus', a))).toEqual([
      0,
      Infinity,
      Infinity,
    ]);
  });

  it('keeps partner rows signed in, and only public prose open to everyone', () => {
    for (const s of GATED_SECTION_KEYS) {
      expect(sectionPartnerRows(DEFAULT_GATE_POLICY, s, signedOut)).toBe(false);
      expect(sectionPartnerRows(DEFAULT_GATE_POLICY, s, locked)).toBe(true);
    }
    expect(fieldGate(DEFAULT_GATE_POLICY, 'company', 'hq', signedOut)).toBe('hidePartner');
    expect(fieldGate(DEFAULT_GATE_POLICY, 'company', 'hq', locked)).toBe('show');
    expect(fieldGate(DEFAULT_GATE_POLICY, 'company', 'description', signedOut)).toBe('show');
    expect(fieldGate(DEFAULT_GATE_POLICY, 'investor', 'description', signedOut)).toBe('show');
    expect(fieldGate(DEFAULT_GATE_POLICY, 'investor', 'hq', signedOut)).toBe('hidePartner');
    expect(DEFAULT_GATE_POLICY.contributionWindowDays).toBe(30);
  });

  it('an unregistered field keeps the fixed partner rule', () => {
    expect(fieldGate(DEFAULT_GATE_POLICY, 'fund', 'managementFeePct', signedOut)).toBe('hidePartner');
    expect(fieldGate(DEFAULT_GATE_POLICY, 'fund', 'managementFeePct', locked)).toBe('show');
  });
});

describe('sectionLimit', () => {
  it('maps hidden / preview / full to 0 / previewRows / Infinity', () => {
    const p = withSection('companyRounds', { signedOut: 'hidden', signedIn: 'preview', unlocked: 'full', previewRows: 5 });
    expect(sectionLimit(p, 'companyRounds', signedOut)).toBe(0);
    expect(sectionLimit(p, 'companyRounds', locked)).toBe(5);
    expect(sectionLimit(p, 'companyRounds', unlocked)).toBe(Infinity);
  });

  it('lets an admin through a section hidden from everyone', () => {
    const p = withSection('companyDiversity', { signedOut: 'hidden', signedIn: 'hidden', unlocked: 'hidden' });
    expect(sectionLimit(p, 'companyDiversity', unlocked)).toBe(0);
    expect(sectionLimit(p, 'companyDiversity', admin)).toBe(Infinity);
    expect(meets(admin, 'contributors')).toBe(true);
  });
});

describe('sectionView', () => {
  it('partner rows alone make signIn', () => {
    const p = withSection('companyInvestors', { signedOut: 'full', signedIn: 'full' });
    expect(sectionView(p, 'companyInvestors', signedOut)).toEqual({ disabled: false, unlockBy: 'signIn', adminOnly: false });
    expect(sectionView(p, 'companyInvestors', locked).unlockBy).toBeNull();
  });

  it('a jump from signed-out hidden to unlocked full makes contribute', () => {
    const p = withSection('companyInvestors', { signedOut: 'hidden', signedIn: 'hidden', partnerAudience: 'everyone' });
    expect(sectionView(p, 'companyInvestors', signedOut).unlockBy).toBe('contribute');
    expect(sectionView(p, 'companyInvestors', locked).unlockBy).toBe('contribute');
  });

  it('a contributed tier at preview makes null', () => {
    const p = withSection('companyPeople', { unlocked: 'preview' });
    expect(sectionView(p, 'companyPeople', unlocked).unlockBy).toBeNull();
  });

  it('the defaults: open signs in, members signs in, contributors contribute', () => {
    expect(sectionView(DEFAULT_GATE_POLICY, 'companyRounds', signedOut).unlockBy).toBe('signIn');
    expect(sectionView(DEFAULT_GATE_POLICY, 'companyRounds', locked).unlockBy).toBe('contribute');
    expect(sectionView(DEFAULT_GATE_POLICY, 'fundTerms', signedOut).unlockBy).toBe('contribute');
    expect(sectionView(DEFAULT_GATE_POLICY, 'companyRounds', unlocked).unlockBy).toBeNull();
  });

  it('switched off: disabled for visitors, adminOnly for an admin', () => {
    const p = withSection('companyDiversity', { signedOut: 'hidden', signedIn: 'hidden', unlocked: 'hidden' });
    expect(sectionView(p, 'companyDiversity', unlocked)).toEqual({ disabled: true, unlockBy: null, adminOnly: false });
    expect(sectionView(p, 'companyDiversity', admin)).toEqual({ disabled: false, unlockBy: null, adminOnly: true });
  });

  it('gateView covers exactly one page', () => {
    expect(Object.keys(gateView(DEFAULT_GATE_POLICY, 'fund', signedOut).sections).sort()).toEqual(
      ['fundCommitments', 'fundMandate', 'fundMetrics', 'fundTerms'],
    );
    expect(Object.keys(gateView(DEFAULT_GATE_POLICY, 'person', signedOut).sections)).toEqual(['personRoles']);
  });
});

describe('fieldGate and fieldUnlockBy', () => {
  it('hides a value below its audience, whoever wrote it', () => {
    const p = withField('company', 'totalRaisedUsd', { audience: 'signedIn' });
    expect(fieldGate(p, 'company', 'totalRaisedUsd', signedOut)).toBe('hide');
    expect(fieldGate(p, 'company', 'totalRaisedUsd', locked)).toBe('show');
    expect(fieldUnlockBy(p, 'company', 'totalRaisedUsd', signedOut, false)).toBe('signIn');
    expect(fieldUnlockBy(p, 'company', 'totalRaisedUsd', locked, false)).toBeNull();
  });

  it('distinguishes a partner-written value from a public one', () => {
    const p = withField('company', 'stage', { partnerAudience: 'contributors' });
    expect(fieldGate(p, 'company', 'stage', locked)).toBe('hidePartner');
    expect(fieldUnlockBy(p, 'company', 'stage', locked, true)).toBe('contribute');
    expect(fieldUnlockBy(p, 'company', 'stage', locked, false)).toBeNull();
    expect(fieldUnlockBy(p, 'company', 'stage', signedOut, true)).toBe('contribute');
  });

  it('an admin sees everything', () => {
    const p = withField('company', 'stage', { audience: 'contributors', partnerAudience: 'contributors' });
    expect(fieldGate(p, 'company', 'stage', admin)).toBe('show');
    expect(fieldUnlockBy(p, 'company', 'stage', admin, true)).toBeNull();
  });
});

describe('validators', () => {
  const ok: SectionPolicy = { signedOut: 'hidden', signedIn: 'preview', unlocked: 'full', previewRows: 2, partnerAudience: 'signedIn' };

  it('accept the defaults', () => {
    for (const s of GATED_SECTION_KEYS) expect(validateSectionPolicy(s, DEFAULT_GATE_POLICY.sections[s])).toBeNull();
    expect(validateFieldPolicy('company', 'hq', DEFAULT_GATE_POLICY.fields.company.hq!)).toBeNull();
  });

  it('reject decreasing levels', () => {
    expect(validateSectionPolicy('companyRounds', { ...ok, signedOut: 'full', signedIn: 'preview' })).toMatch(/less/);
    expect(validateSectionPolicy('companyRounds', { ...ok, unlocked: 'hidden' })).toMatch(/less/);
  });

  it.each(['fundTerms', 'investorFocus', 'fundMandate'])('reject preview on the %s block', (section) => {
    expect(validateSectionPolicy(section, { ...ok, signedOut: 'hidden', signedIn: 'preview' })).toMatch(/whole/);
    expect(validateSectionPolicy(section, { ...ok, signedIn: 'full' })).toBeNull();
  });

  it('reject unknown keys, bad row counts and bad vocabularies', () => {
    expect(validateSectionPolicy('companyNope', ok)).toMatch(/Unknown/);
    expect(validateSectionPolicy('companyRounds', { ...ok, previewRows: 0 })).toMatch(/Preview rows/);
    expect(validateSectionPolicy('companyRounds', { ...ok, previewRows: 26 })).toMatch(/Preview rows/);
    expect(validateSectionPolicy('companyRounds', { ...ok, partnerAudience: 'nobody' as never })).toMatch(/Partner/);
    expect(validateFieldPolicy('company', 'nope', { audience: 'everyone', partnerAudience: 'everyone' })).toMatch(/Unknown/);
    expect(validateFieldPolicy('person', 'name', { audience: 'everyone', partnerAudience: 'everyone' })).toMatch(/Unknown/);
  });

  it('reject a partner audience wider than the field audience', () => {
    expect(validateFieldPolicy('company', 'hq', { audience: 'signedIn', partnerAudience: 'everyone' })).toMatch(/wider/);
    expect(validateFieldPolicy('company', 'hq', { audience: 'signedIn', partnerAudience: 'contributors' })).toBeNull();
  });

  it('bound the window', () => {
    expect(validateWindowDays(1)).toBeNull();
    expect(validateWindowDays(365)).toBeNull();
    expect(validateWindowDays(0)).not.toBeNull();
    expect(validateWindowDays(366)).not.toBeNull();
    expect(validateWindowDays(1.5)).not.toBeNull();
  });
});

describe('resolveGatePolicy', () => {
  it('merges valid overrides and drops the rest, reporting each', () => {
    const { policy, dropped } = resolveGatePolicy({
      sections: [
        { section: 'companyRounds', signedOut: 'full', signedIn: 'full', unlocked: 'full', previewRows: 2, partnerAudience: 'everyone' },
        { section: 'gone', signedOut: 'full', signedIn: 'full', unlocked: 'full', previewRows: 2, partnerAudience: 'everyone' },
        { section: 'companyExits', signedOut: 'full', signedIn: 'hidden', unlocked: 'full', previewRows: 2, partnerAudience: 'everyone' },
      ],
      fields: [
        { entity: 'company', field: 'stage', audience: 'contributors', partnerAudience: 'contributors' },
        { entity: 'company', field: 'gone', audience: 'everyone', partnerAudience: 'everyone' },
        { entity: 'company', field: 'hq', audience: 'bogus', partnerAudience: 'everyone' },
      ],
      contributionWindowDays: 'seven',
    });
    expect(policy.sections.companyRounds.signedOut).toBe('full');
    expect(policy.sections.companyExits).toEqual(DEFAULT_GATE_POLICY.sections.companyExits);
    expect(policy.fields.company.stage).toEqual({ audience: 'contributors', partnerAudience: 'contributors' });
    expect(policy.fields.company.hq).toEqual(DEFAULT_GATE_POLICY.fields.company.hq);
    expect(policy.fields.company).not.toHaveProperty('gone');
    expect(policy.contributionWindowDays).toBe(30);
    expect(dropped).toHaveLength(5);
  });

  it('never mutates the defaults', () => {
    resolveGatePolicy({ sections: [], fields: [{ entity: 'company', field: 'hq', audience: 'contributors', partnerAudience: 'contributors' }], contributionWindowDays: 7 });
    expect(DEFAULT_GATE_POLICY.fields.company.hq).toEqual({ audience: 'everyone', partnerAudience: 'signedIn' });
  });
});

describe('helpers', () => {
  it('describe what search engines see', () => {
    expect(crawlerView(DEFAULT_GATE_POLICY.sections.companyInvestors)).toBe('First 2 rows · public rows only');
    expect(crawlerView(DEFAULT_GATE_POLICY.sections.companyRounds)).toBe('Nothing');
    expect(crawlerView({ ...DEFAULT_GATE_POLICY.sections.companyRounds, signedOut: 'full', signedIn: 'full', partnerAudience: 'everyone' })).toBe('Full');
  });

  it('look a contribution up for a list only when a contributors audience exists', () => {
    expect(needsContributionLookup(DEFAULT_GATE_POLICY, 'company')).toBe(false);
    expect(needsContributionLookup(withField('company', 'stage', { audience: 'contributors', partnerAudience: 'contributors' }), 'company')).toBe(true);
    expect(needsContributionLookup(withSection('investorPortfolio', { partnerAudience: 'contributors' }), 'investor')).toBe(true);
  });
});
