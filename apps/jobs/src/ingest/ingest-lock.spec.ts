import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

const query = jest.fn<(sql: string) => Promise<{ rows: { locked?: boolean }[] }>>();
const connect = jest.fn(async () => undefined);
const end = jest.fn(async () => undefined);

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({ connect, query, end })),
}));

// Imported after the mock so IngestLock picks up the fake Client.
import { IngestLock } from './ingest-lock';

const config = { getOrThrow: () => 'postgresql://x' } as unknown as ConfigService;

describe('IngestLock', () => {
  beforeEach(() => {
    query.mockReset();
    connect.mockClear();
    end.mockClear();
  });

  it('runs the task while holding the lock, then unlocks and disconnects', async () => {
    query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValue({ rows: [] });
    const task = jest.fn(async () => 42);

    const out = await new IngestLock(config).runExclusive('test', task);

    expect(out).toEqual({ ran: true, result: 42 });
    expect(query.mock.calls.map((c) => c[0])).toEqual([
      'SELECT pg_try_advisory_lock($1) AS locked',
      'SELECT pg_advisory_unlock($1)',
    ]);
    expect(end).toHaveBeenCalled();
  });

  it('skips without running the task when another process holds the lock', async () => {
    query.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const task = jest.fn(async () => 42);

    const out = await new IngestLock(config).runExclusive('test', task);

    expect(out).toEqual({ ran: false });
    expect(task).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it('unlocks and disconnects even when the task throws', async () => {
    query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValue({ rows: [] });
    const boom = new Error('ingest failed');

    await expect(
      new IngestLock(config).runExclusive('test', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', expect.anything());
    expect(end).toHaveBeenCalled();
  });
});
