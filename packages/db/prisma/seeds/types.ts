import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * 'bootstrap' — data every environment needs (admin user, reference rows).
 * 'demo'      — illustrative dev data; only applied when SEED_DEMO=true.
 */
export type SeedKind = 'bootstrap' | 'demo';

/** One versioned seed phase. Applied at most once (tracked in SeedHistory),
 *  but bodies must still be idempotent (upsert / insert-if-missing, never
 *  deleteMany) as a safety net for manual re-runs. */
export interface Seed {
  /** Unique, stable id, `NNN-kebab-summary`. Never rename an applied seed. */
  name: string;
  kind: SeedKind;
  run(prisma: PrismaClient): Promise<void>;
}

/** number | null -> BigInt | null for money columns. */
export const money = (v: number | null | undefined): bigint | null =>
  v === null || v === undefined ? null : BigInt(v);
