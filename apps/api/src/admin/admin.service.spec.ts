import { describe, it, expect, jest } from '@jest/globals';

import { AdminService } from './admin.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_REJECTION_REASON } from './submission-notice';

/** The Company row applyProposal reads for its before-state. */
function dbCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    slug: 'helia',
    name: 'Helia',
    domain: 'helia.com',
    oneLiner: 'one liner',
    description: 'desc',
    hq: 'SF',
    founded: 2016,
    headcount: 10,
    industry: ['Fintech'],
    status: 'Private',
    stage: 'Series B',
    totalRaisedUsd: 1000n,
    lastValuationUsd: 4000n,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    legalName: null,
    operatingStatus: null,
    companyType: null,
    primarySector: 'Fintech',
    ...overrides,
  };
}

function makePrisma(
  changes: Record<string, unknown>,
  proposal: Record<string, unknown> = {},
  company = dbCompany(),
) {
  const tx = {
    changeProposal: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'p1',
        companyId: 'c1',
        changes,
        note: null,
        sourceUrl: null,
        submittedById: 'u1',
        moderationStatus: 'PENDING',
        company,
        ...proposal,
      })),
      update: jest.fn(async () => ({})),
    },
    company: { update: jest.fn(async () => ({})) },
    revision: {
      create: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({})),
    },
    source: { upsert: jest.fn(async () => ({ id: 's1' })) },
    citation: { createMany: jest.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    changeProposal: {
      update: jest.fn(async () => ({})),
      // The pre-decision read the contributor email is built from.
      findUnique: jest.fn(async (): Promise<Record<string, unknown> | null> => ({
        moderationStatus: 'PENDING',
        changes,
        company: { slug: 'helia', name: 'Helia' },
        submittedBy: null,
      })),
    },
    company: { update: jest.fn(async () => ({})) },
  };
  return { prisma, tx };
}

/**
 * Prisma double for the child-entity (non-proposal) moderation path.
 *
 * `existingPerson` seeds the deduplicated-human lookup that approving a role
 * runs; null means the name is new and a Person gets minted.
 */
function makeRowPrisma(
  row: Record<string, unknown>,
  existingPerson: Record<string, unknown> | null = null,
  /** What the pre-decision read returns for the contributor email; null = no email. */
  lookup: Record<string, unknown> | null = null,
) {
  const findUnique = jest.fn(async (): Promise<Record<string, unknown> | null> => lookup);
  const tx = {
    company: { update: jest.fn(async () => row) },
    fundingRound: { update: jest.fn(async () => row) },
    personRole: { update: jest.fn(async () => row) },
    person: {
      findFirst: jest.fn(async () => existingPerson),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'h-new' })),
    },
    investorHolding: {
      update: jest.fn(async () => row),
      findUniqueOrThrow: jest.fn(async () => row),
    },
    investor: { updateMany: jest.fn(async () => ({ count: 1 })) },
    acquisitionDeal: { update: jest.fn(async () => row) },
    exitEvent: { update: jest.fn(async () => row) },
    diversitySignal: { update: jest.fn(async () => row) },
    revision: {
      create: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({})),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    company: { findUnique },
    fundingRound: { findUnique },
    personRole: { findUnique },
    investorHolding: { findUnique },
    acquisitionDeal: { findUnique },
    exitEvent: { findUnique },
    diversitySignal: { findUnique },
  };
  return { prisma, tx };
}

function makeMail() {
  return {
    sendSubmissionApprovedEmail: jest.fn(async () => undefined),
    sendSubmissionRejectedEmail: jest.fn(async () => undefined),
  };
}

function newService(prisma: unknown, mail = makeMail()) {
  return new AdminService(prisma as PrismaService, mail as unknown as MailService);
}

function revisionData(call: unknown): Record<string, unknown> {
  return (call as { data: Record<string, unknown> }).data;
}

describe('AdminService.moderate (proposal)', () => {
  it('approving applies the diff to the company (BigInt money) and flips the proposal', async () => {
    const { prisma, tx } = makePrisma({
      hq: 'Berlin',
      totalRaisedUsd: 5000,
      lastValuationUsd: null,
    });
    const service = newService(prisma);

    const result = await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { hq: 'Berlin', totalRaisedUsd: 5000n, lastValuationUsd: null },
    });
    expect(tx.changeProposal.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { moderationStatus: 'APPROVED' },
    });
    expect(result).toEqual({
      id: 'p1',
      type: 'proposal',
      moderationStatus: 'APPROVED',
    });
  });

  it('records one revision per changed field, with the pre-change value', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin', headcount: 42 });
    const service = newService(prisma);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    const rows = revisionData(tx.revision.createMany.mock.calls[0]![0]) as unknown as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({
        companyId: 'c1',
        entityType: 'company',
        entityId: 'c1',
        field: 'hq',
        before: 'SF',
        after: 'Berlin',
        action: 'UPDATE',
        actor: 'ADMIN',
        actorUserId: 'admin1',
        proposalId: 'p1',
      }),
      expect.objectContaining({ field: 'headcount', before: 10, after: 42 }),
    ]);
  });

  it('converts BigInt money columns to numbers on both sides of the diff', async () => {
    const { prisma, tx } = makePrisma({
      totalRaisedUsd: 5000,
      lastValuationUsd: null,
    });
    const service = newService(prisma);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    const rows = revisionData(tx.revision.createMany.mock.calls[0]![0]) as unknown as Record<
      string,
      unknown
    >[];
    // The company row holds BigInt; JSON.stringify would throw on it.
    expect(rows[0]).toMatchObject({
      field: 'totalRaisedUsd',
      before: 1000,
      after: 5000,
    });
    // A field cleared to null stores JsonNull, never bare null (= SQL NULL).
    expect(rows[1]).toMatchObject({ field: 'lastValuationUsd', before: 4000 });
    expect(rows[1]!.after).not.toBeNull();
  });

  it('rejecting only flips the proposal and never touches the company or timeline', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin' });
    const service = newService(prisma);

    await service.moderate('proposal', 'p1', 'REJECTED', 'admin1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.revision.createMany).not.toHaveBeenCalled();
    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.changeProposal.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { moderationStatus: 'REJECTED' },
    });
  });
});

describe('AdminService.moderate (contributed rows)', () => {
  it('records a CREATE revision when a round is approved', async () => {
    const { prisma, tx } = makeRowPrisma({
      id: 'r1',
      companyId: 'c1',
      name: 'Series B',
      date: new Date('2024-03-01'),
      amountUsd: 75_000_000n,
      postMoneyUsd: null,
      lead: 'Sequoia Capital',
      investors: [],
    });
    const service = newService(prisma);

    await service.moderate('round', 'r1', 'APPROVED', 'admin1');

    expect(tx.fundingRound.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: { moderationStatus: 'APPROVED' },
      }),
    );
    const data = revisionData(tx.revision.create.mock.calls[0]![0]);
    expect(data).toMatchObject({
      companyId: 'c1',
      entityType: 'round',
      entityId: 'r1',
      field: '',
      action: 'CREATE',
      actor: 'ADMIN',
      actorUserId: 'admin1',
    });
    // The snapshot is the mapped domain object, BigInt money already numeric.
    expect(data.after).toMatchObject({
      name: 'Series B',
      amountUsd: 75_000_000,
    });
  });

  it('anchors an approved company to its own id', async () => {
    const { prisma, tx } = makeRowPrisma(dbCompany());
    const service = newService(prisma);

    await service.moderate('company', 'c1', 'APPROVED', 'admin1');

    expect(revisionData(tx.revision.create.mock.calls[0]![0])).toMatchObject({
      companyId: 'c1',
      entityType: 'company',
      entityId: 'c1',
    });
  });

  it('publishes the firm an approved holding names', async () => {
    const { prisma, tx } = makeRowPrisma({
      id: 'h1',
      companyId: 'c1',
      investorId: 'i1',
      name: 'Sequoia Capital',
      type: 'Venture',
      firstRound: 'Series B',
      rounds: 2,
      websiteUrl: null,
      linkedinUrl: null,
      investor: { slug: 'sequoia-capital', moderationStatus: 'APPROVED' },
    });
    const service = newService(prisma);

    await service.moderate('investor', 'h1', 'APPROVED', 'admin1');

    expect(tx.investor.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', moderationStatus: 'PENDING' },
      data: { moderationStatus: 'APPROVED' },
    });
    expect(revisionData(tx.revision.create.mock.calls[0]![0]).after).toMatchObject({
      slug: 'sequoia-capital',
      name: 'Sequoia Capital',
    });
  });

  it('resolves an approved person to a new human, and points the role at them', async () => {
    // The same thing approving a holding does for its firm: the contribution
    // becomes reachable from the entity directory, not just the company page.
    const { prisma, tx } = makeRowPrisma({ id: 'x1', companyId: 'c1', name: 'Jane Q. Smith' });
    const service = newService(prisma);

    await service.moderate('person', 'x1', 'APPROVED', 'admin1');

    expect(tx.person.create.mock.calls[0]![0]).toMatchObject({
      data: { slug: 'jane-q-smith', normalizedName: 'jane q smith', moderationStatus: 'APPROVED' },
    });
    expect(tx.personRole.update).toHaveBeenLastCalledWith({
      where: { id: 'x1' },
      data: { personId: 'h-new' },
    });
  });

  it('attaches an approved person to the human already holding that name', async () => {
    const { prisma, tx } = makeRowPrisma(
      { id: 'x1', companyId: 'c1', name: 'JANE  SMITH' },
      { id: 'h-known', suppressedAt: null, mergedIntoId: null },
    );
    const service = newService(prisma);

    await service.moderate('person', 'x1', 'APPROVED', 'admin1');

    expect(tx.person.create).not.toHaveBeenCalled();
    expect(tx.personRole.update).toHaveBeenLastCalledWith({
      where: { id: 'x1' },
      data: { personId: 'h-known' },
    });
  });

  it('follows a tombstone to the survivor', async () => {
    const { prisma, tx } = makeRowPrisma(
      { id: 'x1', companyId: 'c1', name: 'Jane Smith' },
      { id: 'h-lost', suppressedAt: null, mergedIntoId: 'h-live' },
    );
    const service = newService(prisma);

    await service.moderate('person', 'x1', 'APPROVED', 'admin1');

    expect(tx.personRole.update).toHaveBeenLastCalledWith({
      where: { id: 'x1' },
      data: { personId: 'h-live' },
    });
  });

  it('publishes the role unattached when the person asked to be removed', async () => {
    // A removal request has to survive a contribution as much as it survives an
    // ingest run; recreating them under a new row would defeat it.
    const { prisma, tx } = makeRowPrisma(
      { id: 'x1', companyId: 'c1', name: 'Jane Smith' },
      { id: 'h-gone', suppressedAt: new Date(), mergedIntoId: null },
    );
    const service = newService(prisma);

    await service.moderate('person', 'x1', 'APPROVED', 'admin1');

    expect(tx.person.create).not.toHaveBeenCalled();
    // Only the status flip ran; no second update repointed the role.
    expect(tx.personRole.update).toHaveBeenCalledTimes(1);
  });

  it.each(['company', 'round', 'person', 'investor', 'acquisition', 'exit', 'diversity'] as const)(
    'writes no revision when a %s is rejected',
    async (type) => {
      const { prisma, tx } = makeRowPrisma({
        id: 'x1',
        companyId: 'c1',
        investorId: 'i1',
      });
      const service = newService(prisma);

      await service.moderate(type, 'x1', 'REJECTED', 'admin1');

      expect(tx.revision.create).not.toHaveBeenCalled();
      expect(tx.investor.updateMany).not.toHaveBeenCalled();
    },
  );
});

describe('AdminService.applyProposal (citations)', () => {
  it('mints one citation per changed field from the proposal source URL', async () => {
    const { prisma, tx } = makePrisma(
      { hq: 'Berlin', headcount: 42 },
      { sourceUrl: 'https://example.com/annual-report' },
    );
    const service = newService(prisma);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    expect(tx.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { url: 'https://example.com/annual-report' } }),
    );
    const call = tx.citation.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(call.data).toEqual([
      {
        sourceId: 's1',
        entityType: 'company',
        entityId: 'c1',
        field: 'hq',
        submittedById: 'u1',
      },
      {
        sourceId: 's1',
        entityType: 'company',
        entityId: 'c1',
        field: 'headcount',
        submittedById: 'u1',
      },
    ]);
    // Re-approving the same proposal must not blow up on the unique key.
    expect(call.skipDuplicates).toBe(true);
  });

  it('writes no citation when the proposal cited nothing', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin' });
    const service = newService(prisma);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    expect(tx.source.upsert).not.toHaveBeenCalled();
    expect(tx.citation.createMany).not.toHaveBeenCalled();
  });
});

describe('AdminService.moderate (contributor email)', () => {
  const contributor = {
    email: 'ada@example.com',
    name: 'Ada',
    role: 'USER',
    bannedAt: null,
    emailVerifiedAt: new Date('2026-01-01'),
  };
  const round = { id: 'r1', companyId: 'c1', name: 'Series B', date: new Date(), amountUsd: 1n, investors: [] };
  const pendingRound = (submittedBy: Record<string, unknown> | null = contributor) => ({
    moderationStatus: 'PENDING',
    name: 'Series B',
    company: { slug: 'helia', name: 'Helia' },
    submittedBy,
  });

  it('emails the contributor once when their round is approved, after the commit', async () => {
    const { prisma } = makeRowPrisma(round, null, pendingRound());
    const mail = makeMail();
    mail.sendSubmissionApprovedEmail.mockImplementation(async () => {
      // The decision has already committed by the time mail is attempted.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    await newService(prisma, mail).moderate('round', 'r1', 'APPROVED', 'admin1');

    expect(mail.sendSubmissionApprovedEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendSubmissionApprovedEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada',
      'the Series B round for Helia',
      '/companies/helia',
    );
    expect(mail.sendSubmissionRejectedEmail).not.toHaveBeenCalled();
  });

  it("quotes the moderator's note in a rejection and links back to the form", async () => {
    const { prisma } = makeRowPrisma(round, null, pendingRound());
    const mail = makeMail();

    await newService(prisma, mail).moderate('round', 'r1', 'REJECTED', 'admin1', '  No source.  ');

    expect(mail.sendSubmissionRejectedEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada',
      'the Series B round for Helia',
      'No source.',
      '/companies/helia/contribute',
    );
  });

  it('falls back to a stock reason, and sends a rejected company back to /contribute', async () => {
    const { prisma } = makeRowPrisma(dbCompany(), null, {
      moderationStatus: 'PENDING',
      slug: 'helia',
      name: 'Helia',
      submittedBy: contributor,
    });
    const mail = makeMail();

    await newService(prisma, mail).moderate('company', 'c1', 'REJECTED', 'admin1', '   ');

    expect(mail.sendSubmissionRejectedEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada',
      'a new profile for Helia',
      DEFAULT_REJECTION_REASON,
      '/contribute',
    );
  });

  it('sends one email for an edit proposal, however many fields it changes', async () => {
    const { prisma } = makePrisma({ hq: 'Berlin', headcount: 42, totalRaisedUsd: 5000 });
    prisma.changeProposal.findUnique.mockResolvedValue({
      moderationStatus: 'PENDING',
      changes: { hq: 'Berlin', headcount: 42, totalRaisedUsd: 5000 },
      company: { slug: 'helia', name: 'Helia' },
      submittedBy: contributor,
    });
    const mail = makeMail();

    await newService(prisma, mail).moderate('proposal', 'p1', 'APPROVED', 'admin1');

    expect(mail.sendSubmissionApprovedEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendSubmissionApprovedEmail).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada',
      'an edit to Helia (headquarters, headcount, total raised)',
      '/companies/helia',
    );
  });

  it.each([
    ['an ingested row (no submitter)', null],
    ['an admin', { ...contributor, role: 'ADMIN' }],
    ['a banned user', { ...contributor, bannedAt: new Date() }],
    ['an unconfirmed address', { ...contributor, emailVerifiedAt: null }],
  ])('sends nothing for %s', async (_label, submittedBy) => {
    const { prisma } = makeRowPrisma(round, null, pendingRound(submittedBy));
    const mail = makeMail();

    await newService(prisma, mail).moderate('round', 'r1', 'APPROVED', 'admin1');

    expect(mail.sendSubmissionApprovedEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when the decision repeats the current status', async () => {
    const { prisma } = makeRowPrisma(round, null, {
      ...pendingRound(),
      moderationStatus: 'APPROVED',
    });
    const mail = makeMail();

    await newService(prisma, mail).moderate('round', 'r1', 'APPROVED', 'admin1');

    expect(mail.sendSubmissionApprovedEmail).not.toHaveBeenCalled();
  });

  it('still moderates when mail fails, synchronously or asynchronously', async () => {
    for (const fail of [
      () => {
        throw new Error('boom');
      },
      () => Promise.reject(new Error('down')),
    ]) {
      const { prisma, tx } = makeRowPrisma(round, null, pendingRound());
      const mail = makeMail();
      mail.sendSubmissionApprovedEmail.mockImplementation(fail as () => Promise<undefined>);

      await expect(
        newService(prisma, mail).moderate('round', 'r1', 'APPROVED', 'admin1'),
      ).resolves.toEqual({ id: 'r1', type: 'round', moderationStatus: 'APPROVED' });
      expect(tx.fundingRound.update).toHaveBeenCalled();
    }
    // Let the rejected promise's catch handler run before the test ends.
    await new Promise((r) => setImmediate(r));
  });

  it('sends nothing when the decision fails', async () => {
    const { prisma, tx } = makeRowPrisma(round, null, pendingRound());
    tx.fundingRound.update.mockRejectedValue(new Error('gone'));
    const mail = makeMail();

    await expect(
      newService(prisma, mail).moderate('round', 'r1', 'APPROVED', 'admin1'),
    ).rejects.toThrow('not found');
    expect(mail.sendSubmissionApprovedEmail).not.toHaveBeenCalled();
  });
});
