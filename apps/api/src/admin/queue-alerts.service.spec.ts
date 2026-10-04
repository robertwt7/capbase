import { describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import { formatAge, formatQueue, QueueAlertsService, type QueueStats } from './queue-alerts.service';

const NOW = new Date('2026-10-04T08:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const MODELS = [
  'company',
  'fundingRound',
  'personRole',
  'investorHolding',
  'acquisitionDeal',
  'exitEvent',
  'diversitySignal',
  'changeProposal',
] as const;
type Model = (typeof MODELS)[number];
type Pending = Partial<Record<Model, { count: number; oldest?: Date }>>;

/** A prisma whose per-table PENDING aggregates come from `pending` (mutable, so a
 *  test can grow or drain the queue between checks). */
function makePrisma(pending: { current: Pending }, admins = [{ email: 'a@x.dev', name: 'Ada' }]) {
  const prisma: Record<string, unknown> = {
    user: { findMany: jest.fn(async () => admins) },
  };
  for (const model of MODELS) {
    prisma[model] = {
      aggregate: jest.fn(async () => {
        const row = pending.current[model];
        return { _count: { _all: row?.count ?? 0 }, _min: { createdAt: row?.oldest ?? null } };
      }),
    };
  }
  return prisma;
}

function makeMail() {
  return {
    sendQueueDigestEmail: jest.fn(async () => undefined),
    sendQueueAlertEmail: jest.fn(async () => undefined),
  };
}

function newService(prisma: unknown, mail = makeMail(), env: Record<string, string> = {}) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new QueueAlertsService(
    prisma as PrismaService,
    mail as unknown as MailService,
    config,
  );
}

describe('formatAge', () => {
  it('reads in hours under two days and in days after', () => {
    expect(formatAge(10 * 60_000)).toBe('under an hour');
    expect(formatAge(3_600_000)).toBe('1 hour');
    expect(formatAge(47 * 3_600_000)).toBe('47 hours');
    expect(formatAge(73 * 3_600_000)).toBe('3 days');
  });
});

describe('formatQueue', () => {
  it('lists only non-empty types, in queue order, as aligned columns', () => {
    const stats: QueueStats = {
      total: 112,
      countsByType: {
        company: 0,
        round: 100,
        person: 0,
        investor: 0,
        acquisition: 0,
        exit: 0,
        diversity: 0,
        proposal: 12,
      },
      oldest: hoursAgo(30),
    };
    expect(formatQueue(stats, NOW)).toEqual({
      TOTAL: '112 submissions',
      BREAKDOWN: 'Funding rounds   100\nEdits             12',
      OLDEST: '30 hours',
    });
  });

  it('says "1 submission" for a queue of one', () => {
    const counts = { company: 1, round: 0, person: 0, investor: 0, acquisition: 0, exit: 0 };
    const stats = {
      total: 1,
      countsByType: { ...counts, diversity: 0, proposal: 0 },
      oldest: hoursAgo(0),
    };
    expect(formatQueue(stats, NOW).TOTAL).toBe('1 submission');
  });
});

describe('QueueAlertsService.sendDigest', () => {
  it('sends nothing when the queue is empty', async () => {
    const mail = makeMail();
    const sent = await newService(makePrisma({ current: {} }), mail).sendDigest(NOW);
    expect(sent).toBe(false);
    expect(mail.sendQueueDigestEmail).not.toHaveBeenCalled();
  });

  it('emails every admin the counts by type and the oldest item across all tables', async () => {
    const mail = makeMail();
    const prisma = makePrisma(
      {
        current: {
          fundingRound: { count: 2, oldest: hoursAgo(5) },
          changeProposal: { count: 1, oldest: hoursAgo(80) },
        },
      },
      [
        { email: 'a@x.dev', name: 'Ada' },
        { email: 'b@x.dev', name: 'Bo' },
      ],
    );

    expect(await newService(prisma, mail).sendDigest(NOW)).toBe(true);

    const queue = {
      TOTAL: '3 submissions',
      BREAKDOWN: 'Funding rounds   2\nEdits            1',
      OLDEST: '3 days',
    };
    expect(mail.sendQueueDigestEmail.mock.calls).toEqual([
      ['a@x.dev', 'Ada', queue],
      ['b@x.dev', 'Bo', queue],
    ]);
    // Only admins who can still act on it.
    expect((prisma.user as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', bannedAt: null },
      select: { email: true, name: true },
    });
  });

  it('reports a failed query instead of throwing into the cron', async () => {
    const prisma = makePrisma({ current: {} });
    (prisma.company as { aggregate: jest.Mock }).aggregate.mockImplementation(async () => {
      throw new Error('db down');
    });
    await expect(newService(prisma).sendDigest(NOW)).resolves.toBe(false);
  });
});

describe('QueueAlertsService.checkThreshold', () => {
  it('alerts once on reaching the threshold, then re-arms only after dropping below it', async () => {
    const pending: { current: Pending } = { current: { fundingRound: { count: 9 } } };
    const mail = makeMail();
    const service = newService(makePrisma(pending), mail, { QUEUE_ALERT_THRESHOLD: '10' });

    expect(await service.checkThreshold(NOW)).toBe(false); // 9: below

    pending.current = { fundingRound: { count: 10, oldest: hoursAgo(2) } };
    expect(await service.checkThreshold(NOW)).toBe(true); // 10: reached
    expect(mail.sendQueueAlertEmail).toHaveBeenCalledWith(
      'a@x.dev',
      'Ada',
      { TOTAL: '10 submissions', BREAKDOWN: 'Funding rounds   10', OLDEST: '2 hours' },
      10,
    );

    pending.current = { fundingRound: { count: 40 } };
    expect(await service.checkThreshold(NOW)).toBe(false); // still over: no repeat

    pending.current = { fundingRound: { count: 3 } };
    expect(await service.checkThreshold(NOW)).toBe(false); // drained: re-armed

    pending.current = { fundingRound: { count: 12 } };
    expect(await service.checkThreshold(NOW)).toBe(true); // crossed again
    expect(mail.sendQueueAlertEmail).toHaveBeenCalledTimes(2);
  });

  it('defaults the threshold to 100', async () => {
    const pending: { current: Pending } = { current: { company: { count: 99 } } };
    const mail = makeMail();
    const service = newService(makePrisma(pending), mail);

    expect(await service.checkThreshold(NOW)).toBe(false);
    pending.current = { company: { count: 100 } };
    expect(await service.checkThreshold(NOW)).toBe(true);
  });

  it('stays armed when the admin lookup fails, so the next check retries', async () => {
    const pending: { current: Pending } = { current: { company: { count: 5 } } };
    const prisma = makePrisma(pending);
    const findMany = (prisma.user as { findMany: jest.Mock }).findMany;
    findMany.mockImplementationOnce(async () => {
      throw new Error('db blip');
    });
    const mail = makeMail();
    const service = newService(prisma, mail, { QUEUE_ALERT_THRESHOLD: '5' });

    expect(await service.checkThreshold(NOW)).toBe(false);
    expect(await service.checkThreshold(NOW)).toBe(true);
    expect(mail.sendQueueAlertEmail).toHaveBeenCalledTimes(1);
  });
});

describe('QueueAlertsService schedules', () => {
  it('registers the digest and the check, and stops both on shutdown', () => {
    const service = newService(makePrisma({ current: {} }));
    service.onApplicationBootstrap();
    const jobs = (service as unknown as { jobs: { running: boolean }[] }).jobs;
    expect(jobs.map((j) => j.running)).toEqual([true, true]);
    service.onApplicationShutdown();
    expect(jobs.map((j) => j.running)).toEqual([false, false]);
  });

  it('skips the threshold check when QUEUE_ALERT_THRESHOLD is 0', () => {
    const service = newService(makePrisma({ current: {} }), makeMail(), {
      QUEUE_ALERT_THRESHOLD: '0',
    });
    service.onApplicationBootstrap();
    const jobs = (service as unknown as { jobs: unknown[] }).jobs;
    expect(jobs).toHaveLength(1);
    service.onApplicationShutdown();
  });
});
