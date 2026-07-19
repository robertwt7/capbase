// Phased seed runner (Flyway-style). Applies registered seed phases that are
// not yet recorded in SeedHistory, in order. Safe to run unconditionally:
// applied phases are skipped, and 'demo' phases only load when SEED_DEMO=true.
//
//   yarn workspace @repo/db seed                  # pending bootstrap phases
//   SEED_DEMO=true yarn workspace @repo/db seed   # + demo data (local dev)
//   yarn workspace @repo/db seed:baseline         # mark all phases applied
//                                                 #   without running (existing DBs)

import { createSeedClient } from './seeds/client';
import { runSeeds } from './seeds/runner';
import { seeds } from './seeds';

const prisma = createSeedClient();

async function main() {
  const baseline = process.argv.includes('--baseline');
  const demo = process.env.SEED_DEMO === 'true';
  if (baseline) console.log('Baselining: marking phases as applied without running them.');
  await runSeeds(prisma, seeds, { baseline, demo });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
