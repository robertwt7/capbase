import { gateLimit, partnerVisible, type ViewerAccess } from './contributions';
import { DEFAULT_GATE_POLICY } from './visibility';

const base = { unlockedUntil: null, admin: false, windowDays: 30 };
const signedOut: ViewerAccess = { ...base, unlocked: false, signedIn: false };
const locked: ViewerAccess = { ...base, unlocked: false, signedIn: true };
const unlocked: ViewerAccess = { ...base, unlocked: true, signedIn: true };

describe('gateLimit', () => {
  it.each([
    ['companyInvestors', signedOut, 2],
    ['companyInvestors', locked, 2],
    ['companyInvestors', unlocked, Infinity],
    ['companyRounds', signedOut, 0],
    ['companyRounds', locked, 2],
    ['companyRounds', unlocked, Infinity],
    ['fundTerms', signedOut, 0],
    ['fundTerms', locked, 0],
    ['fundTerms', unlocked, Infinity],
  ] as const)('%s → %o gets %d rows under the defaults', (section, access, expected) => {
    expect(gateLimit(section, access, DEFAULT_GATE_POLICY)).toBe(expected);
  });
});

describe('partnerVisible', () => {
  it('hides partner entities from signed-out viewers only', () => {
    expect(partnerVisible(signedOut)).toBe(false);
    expect(partnerVisible(locked)).toBe(true);
    expect(partnerVisible(unlocked)).toBe(true);
    // An unlocked viewer is always signed in, but the rule does not depend on it.
    expect(partnerVisible({ ...unlocked, signedIn: false })).toBe(true);
  });
});
