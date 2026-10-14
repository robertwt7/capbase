import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';

const captureException = jest.fn();
jest.mock('@sentry/nestjs', () => ({ captureException }));
const runCitationBackfill = jest.fn(async () => undefined);
jest.mock('./citation-backfill', () => ({ runCitationBackfill }));

// Imported after the mock so the scheduler picks up the fake Sentry.
import type { IngestLock, LockedRun } from './ingest-lock';
import { IngestScheduler } from './ingest.scheduler';
import type { IngestService } from './ingest.service';
import type { PrismaService } from '../prisma/prisma.service';

const HEARTBEAT = 'https://hc-ping.example/abc';
const fetchMock = jest.fn<typeof fetch>();

function makeScheduler(opts: {
  run?: () => Promise<unknown>;
  locked?: boolean;
  env?: Record<string, string>;
}) {
  const ingest = { run: jest.fn(opts.run ?? (async () => ({ processed: 1 }))) };
  const lock = {
    runExclusive: jest.fn(
      async (_holder: string, fn: () => Promise<unknown>): Promise<LockedRun<unknown>> =>
        opts.locked ? { ran: false } : { ran: true, result: await fn() },
    ),
  };
  const env = { INGEST_HEARTBEAT_URL: HEARTBEAT, ...opts.env };
  const config = { get: (key: string) => env[key as keyof typeof env] } as unknown as ConfigService;
  const jobs = new Map<string, { stop: () => void }>();
  const registry = {
    addCronJob: jest.fn((name: string, job: { stop: () => void }) => jobs.set(name, job)),
  };
  const scheduler = new IngestScheduler(
    ingest as unknown as IngestService,
    lock as unknown as IngestLock,
    config,
    registry as unknown as SchedulerRegistry,
    {} as PrismaService,
  );
  return { scheduler, ingest, lock, registry, jobs };
}

describe('IngestScheduler heartbeat', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    captureException.mockReset();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('pings the heartbeat URL after a successful run', async () => {
    const { scheduler, ingest } = makeScheduler({});
    await scheduler.runOnce();
    expect(ingest.run).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(HEARTBEAT, expect.objectContaining({ method: 'POST' }));
  });

  it('does not ping when the run fails, and reports the failure', async () => {
    const boom = new Error('EDGAR down');
    const { scheduler } = makeScheduler({
      run: async () => {
        throw boom;
      },
    });
    await scheduler.runOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { ingest: 'scheduled' } });
  });

  it('does not ping when a backfill holds the lock and the tick is skipped', async () => {
    const { scheduler, ingest } = makeScheduler({ locked: true });
    await scheduler.runOnce();
    expect(ingest.run).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op without INGEST_HEARTBEAT_URL', async () => {
    const { scheduler } = makeScheduler({ env: { INGEST_HEARTBEAT_URL: '' } });
    await scheduler.runOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws or reports when the monitor is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { scheduler } = makeScheduler({});
    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('IngestScheduler monthly snapshots', () => {
  const realFetch = global.fetch;
  let stops: (() => void)[] = [];
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    captureException.mockReset();
    runCitationBackfill.mockClear();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
    // Cron jobs hold timers; stop them so jest can exit.
    stops.forEach((stop) => stop());
    stops = [];
  });

  function boot(env: Record<string, string>) {
    const made = makeScheduler({ env });
    made.scheduler.onApplicationBootstrap();
    stops = [...made.jobs.values()].map((j) => () => j.stop());
    return made;
  }

  it('registers no monthly job while MONTHLY_INGEST_SOURCES is empty', () => {
    const { jobs } = boot({});
    expect([...jobs.keys()]).toEqual(['sec-form-d']);
  });

  it('registers the monthly job when sources are configured', () => {
    const { jobs } = boot({ MONTHLY_INGEST_SOURCES: 'INNOVATE_UK, COMPANIES_HOUSE' });
    expect([...jobs.keys()]).toEqual(['sec-form-d', 'monthly-snapshots']);
  });

  it('fails boot loudly on an invalid schedule', () => {
    const made = makeScheduler({
      env: { MONTHLY_INGEST_SOURCES: 'INNOVATE_UK', MONTHLY_CRON_SCHEDULE: 'not a cron' },
    });
    expect(() => made.scheduler.onApplicationBootstrap()).toThrow(/MONTHLY_CRON_SCHEDULE/);
    stops = [...made.jobs.values()].map((j) => () => j.stop());
  });

  it('runs the configured sources, then mints citations, then pings its own heartbeat', async () => {
    const { scheduler, ingest } = makeScheduler({
      env: {
        MONTHLY_INGEST_SOURCES: 'INNOVATE_UK,COMPANIES_HOUSE',
        MONTHLY_INGEST_HEARTBEAT_URL: 'https://hc-ping.example/monthly',
      },
    });
    await scheduler.runMonthly();

    expect(ingest.run).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['INNOVATE_UK', 'COMPANIES_HOUSE'] }),
    );
    expect(runCitationBackfill).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hc-ping.example/monthly',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('skips when another ingest holds the lock, minting nothing and pinging nothing', async () => {
    const { scheduler, ingest } = makeScheduler({
      locked: true,
      env: { MONTHLY_INGEST_SOURCES: 'INNOVATE_UK' },
    });
    await scheduler.runMonthly();
    expect(ingest.run).not.toHaveBeenCalled();
    expect(runCitationBackfill).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed monthly run and stays alive', async () => {
    const boom = new Error('register moved');
    const { scheduler } = makeScheduler({
      run: async () => {
        throw boom;
      },
      env: { MONTHLY_INGEST_SOURCES: 'COMPANIES_HOUSE' },
    });
    await expect(scheduler.runMonthly()).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { ingest: 'monthly' } });
    expect(runCitationBackfill).not.toHaveBeenCalled();
  });
});
