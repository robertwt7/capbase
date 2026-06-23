import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

/**
 * Build a PrismaClient wired to Postgres via the pg adapter (Prisma 7 needs an
 * adapter; the datasource URL is not read from the schema). Shared by every app
 * that talks to the database so they all use one schema + generated client.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Re-export the full generated client surface (PrismaClient, model row types,
// enums) so consumers import everything from `@repo/db`.
export * from './generated/prisma/client';
