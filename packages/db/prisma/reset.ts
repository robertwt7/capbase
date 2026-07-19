// DESTRUCTIVE dev helper: wipe all domain data (companies cascade to every
// child table), clear the seed ledger, then re-apply every seed phase with
// demo data enabled. This is the old wipe-and-reload `seed` behaviour, now an
// explicit separate command (`make db-reset`).

import { createSeedClient } from './seeds/client';
import { runSeeds } from './seeds/runner';
import { seeds } from './seeds';

const prisma = createSeedClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db reset refuses to run with NODE_ENV=production');
  }

  const [companies, users] = await Promise.all([prisma.company.count(), prisma.user.count()]);
  console.log(`Wiping ${companies} companies and ${users} users (children cascade)…`);

  await prisma.company.deleteMany();
  await prisma.user.deleteMany();
  await prisma.seedHistory.deleteMany();

  await runSeeds(prisma, seeds, { demo: true });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
