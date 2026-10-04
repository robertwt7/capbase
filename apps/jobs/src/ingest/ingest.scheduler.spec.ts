import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';

const captureException = jest.fn();
jest.mock('@sentry/nestjs', () => ({ captureException }));

// Imported after the mock so the scheduler picks up the fake Sentry.
import type { IngestLock, LockedRun } from './ingest-lock';
import { IngestScheduler } from './ingest.scheduler';
import type { IngestService } from './ingest.service';

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
  const scheduler = new IngestScheduler(
    ingest as unknown as IngestService,
    lock as unknown as IngestLock,
    config,
    {} as SchedulerRegistry,
  );
  return { scheduler, ingest };
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
