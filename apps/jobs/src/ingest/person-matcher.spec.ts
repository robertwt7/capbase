import { describe, it, expect } from '@jest/globals';

import {
  assignPeople,
  nameVariantKey,
  personQid,
  uniquePersonSlug,
  variantPairs,
  type BackfillRole,
  type ExistingPeople,
} from './person-matcher';

function role(overrides: Partial<BackfillRole> = {}): BackfillRole {
  return {
    id: 'r1',
    name: 'Jane Smith',
    orgId: 'co-1',
    externalSource: 'SEC_EDGAR',
    externalId: 'X1:person:jane-smith',
    personId: null,
    approved: true,
    ...overrides,
  };
}

function empty(over: Partial<ExistingPeople> = {}): ExistingPeople {
  return {
    byQid: new Map(),
    byName: new Map(),
    slugs: new Set(),
    suppressed: new Set(),
    ...over,
  };
}

describe('personQid', () => {
  it('reads the human QID out of a Wikidata role externalId', () => {
    // wikidata.mapper mints `${companyQid}:person:${personQid}:${role}`, so the
    // person's own identifier is already stored on the row.
    expect(personQid('WIKIDATA', 'Q42:person:Q7:CEO')).toBe('Q7');
    expect(personQid('WIKIDATA', 'Q42:person:q7:Founder')).toBe('Q7');
  });

  it('returns null for a malformed QID rather than storing it', () => {
    expect(personQid('WIKIDATA', 'Q42:person:P1278:CEO')).toBeNull();
    expect(personQid('WIKIDATA', 'Q42:person::CEO')).toBeNull();
    expect(personQid('WIKIDATA', 'Q42:person')).toBeNull();
  });

  it('claims nothing for a non-Wikidata row', () => {
    expect(personQid('SEC_EDGAR', '320193:person:jane-smith')).toBeNull();
    expect(personQid(null, null)).toBeNull();
  });
});

describe('nameVariantKey', () => {
  it('keeps first and last only, so a middle name does not separate two rows', () => {
    expect(nameVariantKey('Jane A. Smith')).toBe('jane smith');
    expect(nameVariantKey('JANE SMITH')).toBe('jane smith');
    expect(nameVariantKey('Jane Smith')).toBe('jane smith');
  });

  it('drops a personal suffix before taking the last name', () => {
    expect(nameVariantKey('Adam Larson Jr.')).toBe('adam larson');
    expect(nameVariantKey('Adam Larson III')).toBe('adam larson');
  });

  it('is empty when nothing survives normalization', () => {
    expect(nameVariantKey('   ')).toBe('');
    expect(nameVariantKey('!!!')).toBe('');
  });
});

describe('uniquePersonSlug', () => {
  it('increments on collision', () => {
    const taken = new Set<string>();
    expect(uniquePersonSlug('Jane Smith', taken)).toBe('jane-smith');
    expect(uniquePersonSlug('Jane Smith', taken)).toBe('jane-smith-2');
    expect(uniquePersonSlug('JANE  SMITH', taken)).toBe('jane-smith-3');
  });
});

describe('assignPeople', () => {
  it('collapses two Wikidata roles with the same person QID at different companies', () => {
    // The serial-founder case the ticket is about: 10 QIDs already span more
    // than one company today, and nothing indexed them.
    const plan = assignPeople(
      [
        role({
          id: 'r1',
          orgId: 'co-1',
          externalSource: 'WIKIDATA',
          externalId: 'Q1:person:Q30:Founder',
          name: 'Patrick Collison',
        }),
        role({
          id: 'r2',
          orgId: 'co-2',
          externalSource: 'WIKIDATA',
          externalId: 'Q2:person:Q30:CEO',
          name: 'Patrick Collison',
        }),
      ],
      empty(),
    );

    expect(plan.created).toHaveLength(1);
    expect(plan.created[0]).toMatchObject({ qid: 'Q30', roleIds: ['r1', 'r2'] });
  });

  it('falls through to the name pass when the QID is malformed, and counts it', () => {
    const plan = assignPeople(
      [
        role({
          id: 'r1',
          externalSource: 'WIKIDATA',
          externalId: 'Q1:person:P1278:Founder',
        }),
      ],
      empty(),
    );

    expect(plan.malformedQids).toBe(1);
    expect(plan.created).toHaveLength(1);
    expect(plan.created[0]!.qid).toBeNull();
  });

  it('collapses two roles with the same normalized name', () => {
    const plan = assignPeople(
      [
        role({ id: 'r1', orgId: 'co-1', name: 'Paul Grossinger' }),
        role({ id: 'r2', orgId: 'co-2', name: 'PAUL  GROSSINGER' }),
      ],
      empty(),
    );

    expect(plan.created).toHaveLength(1);
    expect(plan.created[0]!.roleIds).toEqual(['r1', 'r2']);
  });

  it('keeps a middle-initial variant as a SEPARATE person', () => {
    // Exact normalized equality auto-merges; anything looser is a human's call.
    const plan = assignPeople(
      [
        role({ id: 'r1', name: 'Jane Smith' }),
        role({ id: 'r2', name: 'Jane A. Smith' }),
      ],
      empty(),
    );

    expect(plan.created).toHaveLength(2);
    expect(plan.created.map((p) => p.slug)).toEqual(['jane-smith', 'jane-a-smith']);
  });

  it('lets the identifier pass win, so the QID keeps the identity', () => {
    // Order matters: a name-keyed person created first would leave the QID
    // landing on a second row for the same human.
    const plan = assignPeople(
      [
        role({ id: 'r-name', name: 'Patrick Collison', externalSource: 'SEC_EDGAR' }),
        role({
          id: 'r-qid',
          name: 'Patrick Collison',
          externalSource: 'WIKIDATA',
          externalId: 'Q1:person:Q30:Founder',
        }),
      ],
      empty(),
    );

    expect(plan.created).toHaveLength(1);
    expect(plan.created[0]!.qid).toBe('Q30');
    expect(plan.created[0]!.roleIds).toEqual(['r-qid', 'r-name']);
  });

  it('attaches to a person that already exists, by QID and by name', () => {
    const existing = empty({
      byQid: new Map([['Q30', 'p-qid']]),
      byName: new Map([['jane smith', 'p-name']]),
      slugs: new Set(['patrick-collison', 'jane-smith']),
    });
    const plan = assignPeople(
      [
        role({
          id: 'r1',
          externalSource: 'WIKIDATA',
          externalId: 'Q1:person:Q30:Founder',
          name: 'Patrick Collison',
        }),
        role({ id: 'r2', name: 'Jane Smith' }),
      ],
      existing,
    );

    expect(plan.created).toHaveLength(0);
    expect(plan.attached.get('r1')).toBe('p-qid');
    expect(plan.attached.get('r2')).toBe('p-name');
  });

  it('leaves a row that already carries a personId completely alone', () => {
    const plan = assignPeople([role({ personId: 'p-1' })], empty());

    expect(plan.skipped).toBe(1);
    expect(plan.created).toHaveLength(0);
    expect(plan.attached.size).toBe(0);
  });

  it('never mints a new row for a human who asked to be removed', () => {
    // The suppressed person is absent from byName (matching would revive them),
    // so without the explicit guard the name pass would create a SECOND row —
    // and this backfill is a step of ingest-all, so a rebuild would undo every
    // removal request.
    const plan = assignPeople(
      [
        role({ id: 'r1', name: 'Jane Smith' }),
        role({
          id: 'r2',
          name: 'Jane Smith',
          externalSource: 'WIKIDATA',
          externalId: 'Q1:person:Q30:Founder',
        }),
      ],
      empty({ suppressed: new Set(['jane smith']) }),
    );

    expect(plan.created).toHaveLength(0);
    expect(plan.attached.size).toBe(0);
    expect(plan.suppressed).toBe(2);
  });

  it('counts an unusable name rather than minting an identity from a blank', () => {
    const plan = assignPeople([role({ name: '   ' })], empty());

    expect(plan.unusable).toBe(1);
    expect(plan.created).toHaveLength(0);
  });

  it('publishes a person only when something public references them', () => {
    const plan = assignPeople(
      [
        role({ id: 'r1', name: 'Pending Only', approved: false }),
        role({ id: 'r2', name: 'Half Public', approved: false }),
        role({ id: 'r3', orgId: 'co-2', name: 'HALF HALF', approved: false }),
        role({ id: 'r4', orgId: 'co-3', name: 'Half Half', approved: true }),
      ],
      empty(),
    );

    const byName = new Map(plan.created.map((p) => [p.name, p]));
    expect(byName.get('Pending Only')!.approved).toBe(false);
    expect(byName.get('HALF HALF')!.approved).toBe(true);
  });
});

describe('variantPairs', () => {
  it('pairs two people who share a first and last name at one organisation', () => {
    const { pairs } = variantPairs(
      [
        { personId: 'p1', orgId: 'co-1', name: 'Jane Smith' },
        { personId: 'p2', orgId: 'co-1', name: 'Jane A. Smith' },
      ],
      8,
    );

    expect(pairs).toEqual([{ aId: 'p1', bId: 'p2', evidence: 'jane smith' }]);
  });

  it('proposes nothing for one person holding several roles at one company', () => {
    const { pairs } = variantPairs(
      [
        { personId: 'p1', orgId: 'co-1', name: 'Jane Smith' },
        { personId: 'p1', orgId: 'co-1', name: 'JANE SMITH' },
      ],
      8,
    );

    expect(pairs).toEqual([]);
  });

  it('does not pair the same name across two different organisations', () => {
    // The sweep asks "two spellings at one org", which is what makes it
    // high-precision; a shared name across companies is just a common name.
    const { pairs } = variantPairs(
      [
        { personId: 'p1', orgId: 'co-1', name: 'Jane Smith' },
        { personId: 'p2', orgId: 'co-2', name: 'Jane A. Smith' },
      ],
      8,
    );

    expect(pairs).toEqual([]);
  });

  it('skips a group larger than the limit rather than flooding the queue', () => {
    const roles = Array.from({ length: 5 }, (_, i) => ({
      personId: `p${i}`,
      orgId: 'co-1',
      name: `Jane ${'A'.repeat(i + 1)} Smith`,
    }));
    const { pairs, skipped } = variantPairs(roles, 4);

    expect(pairs).toEqual([]);
    expect(skipped).toEqual([{ key: 'jane smith', size: 5 }]);
  });

  it('ignores a role with no organisation', () => {
    const { pairs } = variantPairs(
      [
        { personId: 'p1', orgId: null, name: 'Jane Smith' },
        { personId: 'p2', orgId: null, name: 'Jane A. Smith' },
      ],
      8,
    );

    expect(pairs).toEqual([]);
  });
});
