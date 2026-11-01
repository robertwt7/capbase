/**
 * Database sessions for the company-match repair.
 *
 * Deliberately plain `pg`: the CLI never boots Nest, the scheduler, the
 * enrichment clients or the error reporter, so an audit cannot ingest, fetch a
 * provider, or ship repair evidence anywhere. Read sessions are read-only at
 * the SERVER (`default_transaction_read_only`), not by convention: even a
 * write-capable DATABASE_URL cannot write through one.
 */
import { Client, type ClientConfig } from 'pg';

import { INGEST_LOCK_KEY } from '../ingest/ingest-lock';
import { canonicalJson, sha256 } from '../ingest/company-matcher';

/** A minimal query surface, so the same hydration runs in a read-only audit
 *  session and inside an apply transaction. */
export interface Q {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

const READ_OPTIONS = [
  '-c default_transaction_read_only=on',
  '-c statement_timeout=300000',
  '-c lock_timeout=5000',
  '-c idle_in_transaction_session_timeout=600000',
  '-c application_name=company-match-repair:read',
].join(' ');

const WRITE_OPTIONS = [
  '-c statement_timeout=60000',
  '-c lock_timeout=10000',
  '-c idle_in_transaction_session_timeout=120000',
  '-c application_name=company-match-repair:write',
].join(' ');

function config(url: string, options: string): ClientConfig {
  return { connectionString: url, options };
}

/** A server-enforced read-only session. Verified, not assumed. */
export async function readOnlySession(url: string): Promise<Client> {
  const client = new Client(config(url, READ_OPTIONS));
  await client.connect();
  const { rows } = await client.query<{ default_transaction_read_only: string }>('SHOW default_transaction_read_only');
  if (rows[0]?.default_transaction_read_only !== 'on') {
    await client.end();
    throw new Error('could not open a read-only session');
  }
  return client;
}

export async function writeSession(url: string): Promise<Client> {
  const client = new Client(config(url, WRITE_OPTIONS));
  await client.connect();
  return client;
}

/** Whether the repair/binding tables exist (the audit runs before the migration too). */
export async function repairTablesPresent(q: Q): Promise<{ bindings: boolean; ledger: boolean }> {
  const { rows } = await q.query<{ b: boolean; l: boolean }>(
    `SELECT to_regclass('"CompanyIngestBinding"') IS NOT NULL AS b,
            to_regclass('"CompanyRepairGroup"') IS NOT NULL AND to_regclass('"CompanyRepairRun"') IS NOT NULL AS l`,
  );
  return { bindings: rows[0]?.b === true, ledger: rows[0]?.l === true };
}

export interface TargetIdentity {
  targetId: string;
  database: string;
  databaseOid: string;
  /** The cluster's system identifier when readable, else the server endpoint. */
  server: string;
}

/**
 * The target fingerprint: SHA-256 over an operator-provisioned per-target id
 * (REPAIR_TARGET_ID — never stored in the database, so a restored backup or a
 * clone does not carry it), the database name and OID, and the server's
 * identity. A clone gets a different target id by construction.
 */
export async function targetFingerprint(q: Q, targetId: string): Promise<{ fingerprint: string; identity: TargetIdentity }> {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(targetId)) {
    throw new Error('REPAIR_TARGET_ID must be 8–128 characters of [A-Za-z0-9._:-] (a UUID is ideal)');
  }
  const { rows } = await q.query<{ db: string; oid: string; addr: string | null; port: number | null }>(
    `SELECT current_database() AS db, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
            host(inet_server_addr()) AS addr, inet_server_port() AS port`,
  );
  let server = `${rows[0]?.addr ?? 'socket'}:${rows[0]?.port ?? ''}`;
  try {
    const sys = await q.query<{ id: string }>('SELECT system_identifier::text AS id FROM pg_control_system()');
    if (sys.rows[0]?.id) server = `system:${sys.rows[0].id}`;
  } catch {
    // Not permitted for this role: the endpoint identity stands in.
  }
  const identity: TargetIdentity = { targetId, database: rows[0]!.db, databaseOid: rows[0]!.oid, server };
  return { fingerprint: sha256(canonicalJson(identity)), identity };
}

/**
 * The ingest advisory lock, on its own session, held for a whole write run.
 * Losing that session releases the lock, so every group transaction checks —
 * from inside the transaction — that the lock is still held by that session's
 * backend before it writes (`assertHeld`). The lock excludes ingest only, never
 * human or API edits; those are excluded by the row locks each group takes.
 */
export class RepairLock {
  private lost = false;
  private pid = 0;
  private constructor(private readonly client: Client) {
    client.on('error', () => (this.lost = true));
    client.on('end', () => (this.lost = true));
  }

  /** null when another ingest holds the lock (exit 75 — never wait or kill). */
  static async acquire(url: string): Promise<RepairLock | null> {
    const client = new Client({ connectionString: url, options: '-c application_name=company-match-repair:lock' });
    await client.connect();
    const { rows } = await client.query<{ locked: boolean; pid: number }>(
      'SELECT pg_try_advisory_lock($1) AS locked, pg_backend_pid() AS pid',
      [INGEST_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      await client.end();
      return null;
    }
    const lock = new RepairLock(client);
    lock.pid = rows[0].pid;
    return lock;
  }

  /** Throws unless the lock session is alive and still holds the lock. */
  async assertHeld(tx: Q): Promise<void> {
    if (this.lost) throw new LockLostError();
    const { rows } = await tx.query<{ held: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1
                        AND objsubid = 1 AND pid = $2 AND granted) AS held`,
      [INGEST_LOCK_KEY, this.pid],
    );
    if (!rows[0]?.held) throw new LockLostError();
  }

  async release(): Promise<void> {
    if (this.lost) return;
    await this.client.query('SELECT pg_advisory_unlock($1)', [INGEST_LOCK_KEY]).catch(() => undefined);
    await this.client.end().catch(() => undefined);
  }

  /** For tests: simulate the lock session dying. */
  async kill(): Promise<void> {
    await this.client.end().catch(() => undefined);
    this.lost = true;
  }
}

export class LockLostError extends Error {
  constructor() {
    super('the ingest lock session was lost — stopping before any further write');
  }
}

/** Keyset-page a query whose first param is the last key seen. */
export async function* pages<T extends Record<string, unknown>>(
  q: Q,
  sql: (limit: number) => string,
  key: (row: T) => string,
  limit = 20_000,
): AsyncGenerator<T[]> {
  let after = '';
  for (;;) {
    const { rows } = await q.query<T>(sql(limit), [after]);
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < limit) return;
    after = key(rows[rows.length - 1]!);
  }
}
