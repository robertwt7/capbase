import { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';

const captureException = jest.fn();
const captureMessage = jest.fn();
jest.mock('@sentry/nestjs', () => ({ captureException, captureMessage }));
jest.mock('./website-enrichment.service', () => ({ WebsiteEnrichmentService: class WebsiteEnrichmentService {} }), { virtual: true });

import type { IngestLock } from '../ingest/ingest-lock';
import { EnrichmentScheduler } from './enrichment.scheduler';
import type { WebsiteEnrichmentService } from './website-enrichment.service';

const HEARTBEAT = 'https://heartbeat.example/tech';
const counters = { attempted: 1, detected: 1, noDetections: 0, blocked: 0, retryableFailures: 0 };
const jobs: CronJob[] = [];
function makeScheduler(options: {
  env?: Record<string, string>;
  locked?: boolean;
  run?: (options: { limit?: number; signal?: AbortSignal }) => Promise<typeof counters>;
} = {}) {
  const config = new ConfigService({
    TECH_ENRICHMENT_ENABLED: 'true', TECH_ENRICHMENT_COMPANY_IDS: 'company-1', TECH_ENRICHMENT_HEARTBEAT_URL: HEARTBEAT,
    ...options.env,
  });
  const service = { run: jest.fn(options.run ?? (async () => counters)) };
  const lock = { runExclusive: jest.fn(async (_holder: string, fn: () => Promise<unknown>) => options.locked ? { ran: false } : { ran: true, result: await fn() }) };
  const registry = { addCronJob: jest.fn((_name: string, job: CronJob) => { jobs.push(job); }) };
  const scheduler = new EnrichmentScheduler(service as unknown as WebsiteEnrichmentService, lock as unknown as IngestLock, config, registry as unknown as SchedulerRegistry);
  return { scheduler, service, lock, registry };
}

describe('opt-in website enrichment scheduler', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    captureException.mockReset();
    captureMessage.mockReset();
  });
  afterEach(() => {
    jobs.splice(0).forEach((job) => job.stop());
    global.fetch = originalFetch;
    jest.useRealTimers();
  });
  it('registers nothing and performs no work or requests while disabled', async () => {
    const made = makeScheduler({ env: { TECH_ENRICHMENT_ENABLED: 'false' } });
    made.scheduler.onApplicationBootstrap();
    await made.scheduler.runOnce();
    expect(made.registry.addCronJob).not.toHaveBeenCalled();
    expect(made.service.run).not.toHaveBeenCalled();
    expect(made.lock.runExclusive).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('registers the bounded schedule explicitly in UTC', () => {
    const made = makeScheduler();
    made.scheduler.onApplicationBootstrap();
    expect(made.registry.addCronJob).toHaveBeenCalledWith('website-technology', jobs[0]);
    expect(jobs[0]?.cronTime.timeZone).toBe('UTC');
  });
  it('fails boot on invalid enabled configuration', () => {
    const made = makeScheduler({ env: { TECH_ENRICHMENT_LIMIT: '1000000' } });
    expect(() => made.scheduler.onApplicationBootstrap()).toThrow('TECH_ENRICHMENT_LIMIT');
    expect(made.registry.addCronJob).not.toHaveBeenCalled();
  });
  it('does no work for an empty cohort', async () => {
    const made = makeScheduler({ env: { TECH_ENRICHMENT_COMPANY_IDS: '' } });
    await made.scheduler.runOnce();
    expect(made.service.run).not.toHaveBeenCalled();
    expect(made.lock.runExclusive).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('holds the shared ingestion lock and heartbeats completed work', async () => {
    const made = makeScheduler();
    await made.scheduler.runOnce();
    expect(made.lock.runExclusive).toHaveBeenCalledTimes(1);
    expect(made.service.run).toHaveBeenCalledWith({ limit: 5, signal: expect.any(AbortSignal) });
    expect(fetchMock).toHaveBeenCalledWith(HEARTBEAT, expect.objectContaining({ method: 'POST' }));
  });
  it('skips rather than overlapping an ingestion or another process', async () => {
    const made = makeScheduler({ locked: true });
    await made.scheduler.runOnce();
    expect(made.service.run).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('prevents in-process overlap and permits the next batch after completion', async () => {
    let finish!: (value: typeof counters) => void;
    const made = makeScheduler({ run: () => new Promise((resolve) => { finish = resolve; }) });
    const first = made.scheduler.runOnce();
    await made.scheduler.runOnce();
    expect(made.service.run).toHaveBeenCalledTimes(1);
    finish(counters);
    await first;
    made.service.run.mockResolvedValue(counters);
    await made.scheduler.runOnce();
    expect(made.service.run).toHaveBeenCalledTimes(2);
  });
  it('aborts collection at the run deadline without releasing its lock early or heartbeating', async () => {
    jest.useFakeTimers();
    let aborted = false;
    const made = makeScheduler({
      env: { TECH_ENRICHMENT_TIMEOUT_MS: '1000' },
      run: ({ signal }) => new Promise((resolve) => {
        signal!.addEventListener('abort', () => { aborted = true; resolve(counters); }, { once: true });
      }),
    });
    const batch = made.scheduler.runOnce();
    await jest.advanceTimersByTimeAsync(1000);
    await batch;
    expect(aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { enrichment: 'scheduled' } });
  });
  it('reports source coverage failures separately from batch completion', async () => {
    const made = makeScheduler({ run: async () => ({ ...counters, detected: 0, blocked: 1 }) });
    await made.scheduler.runOnce();
    expect(captureMessage).toHaveBeenCalledWith('Technology source coverage failure', expect.objectContaining({ level: 'warning' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reports collection failures without success heartbeat, then recovers next tick', async () => {
    const boom = new Error('Commit failed');
    const made = makeScheduler({ run: async () => { throw boom; } });
    await expect(made.scheduler.runOnce()).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { enrichment: 'scheduled' } });
    expect(fetchMock).not.toHaveBeenCalled();
    made.service.run.mockResolvedValue(counters);
    await made.scheduler.runOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
