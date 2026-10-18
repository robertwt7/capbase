import { GATED_SECTIONS, PREVIEW_LIMIT, gateLimit, partnerVisible, type ViewerAccess } from './contributions';

const signedOut: ViewerAccess = { unlocked: false, signedIn: false, unlockedUntil: null };
const locked: ViewerAccess = { unlocked: false, signedIn: true, unlockedUntil: null };
const unlocked: ViewerAccess = { unlocked: true, signedIn: true, unlockedUntil: null };

const sectionOf = (tier: string) =>
  (Object.keys(GATED_SECTIONS) as (keyof typeof GATED_SECTIONS)[]).find((s) => GATED_SECTIONS[s] === tier)!;

describe('gateLimit', () => {
  it.each([
    ['open', signedOut, PREVIEW_LIMIT],
    ['open', locked, PREVIEW_LIMIT],
    ['open', unlocked, Infinity],
    ['members', signedOut, 0],
    ['members', locked, PREVIEW_LIMIT],
    ['members', unlocked, Infinity],
    ['contributors', signedOut, 0],
    ['contributors', locked, 0],
    ['contributors', unlocked, Infinity],
  ] as const)('%s section → %o gets %d rows', (tier, access, expected) => {
    expect(gateLimit(sectionOf(tier), access)).toBe(expected);
  });

  it('gates the money sections, not the names', () => {
    expect(GATED_SECTIONS.companyRounds).toBe('members');
    expect(GATED_SECTIONS.companyInvestors).toBe('open');
    expect(GATED_SECTIONS.fundTerms).toBe('contributors');
  });
});

describe('partnerVisible', () => {
  it('hides partner data from signed-out viewers only', () => {
    expect(partnerVisible(signedOut)).toBe(false);
    expect(partnerVisible(locked)).toBe(true);
    expect(partnerVisible(unlocked)).toBe(true);
    // An unlocked viewer is always signed in, but the rule does not depend on it.
    expect(partnerVisible({ ...unlocked, signedIn: false })).toBe(true);
  });
});
