import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client';

/** Standalone client for the seed CLIs (mirrors the app's adapter setup). */
export function createSeedClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL as string });
  return new PrismaClient({ adapter });
}
