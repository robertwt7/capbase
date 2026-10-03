import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

/** Arbitrary but fixed: every ingest (cron or manual) contends for this key. */
export const INGEST_LOCK_KEY = 7_311_002;

export type LockedRun<T> = { ran: true; result: T } | { ran: false };

/**
 * Cross-process mutual exclusion for ingests, via a Postgres advisory lock.
 *
 * The in-process `running` flag only stops the cron overlapping itself; a
 * manual `make ingest-prod` is a separate container. Two ingests at once race
 * on the same upserts and on the match indexes each loads at start.
 *
 * Advisory locks belong to a session, and Prisma's pool hands queries to any
 * connection, so the lock gets a dedicated `pg` client held for the whole run.
 * If the process dies, Postgres closes the session and the lock goes with it —
 * no stale lock to clean up by hand.
 */
@Injectable()
export class IngestLock {
  private readonly logger = new Logger(IngestLock.name);

  constructor(private readonly config: ConfigService) {}

  /** Run `fn` holding the lock, or return `{ ran: false }` at once if another
   *  ingest holds it. Never waits. */
  async runExclusive<T>(holder: string, fn: () => Promise<T>): Promise<LockedRun<T>> {
    const client = new Client({ connectionString: this.config.getOrThrow<string>('DATABASE_URL') });
    await client.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [INGEST_LOCK_KEY],
      );
      if (!rows[0]?.locked) {
        this.logger.warn(`Ingest lock held by another process — skipping ${holder}`);
        return { ran: false };
      }
      this.logger.log(`Ingest lock acquired by ${holder}`);
      try {
        return { ran: true, result: await fn() };
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [INGEST_LOCK_KEY]).catch(() => {});
      }
    } finally {
      await client.end().catch(() => {});
    }
  }
}
