import type { PrismaClient } from '../../src/generated/prisma/client';
import type { Seed } from './types';

export interface RunOptions {
  /** Mark pending phases as applied WITHOUT running them (existing DBs). */
  baseline?: boolean;
  /** Apply 'demo' phases too. Bootstrap phases always apply. */
  demo?: boolean;
}

/** Apply pending seed phases in registry order, recording each in SeedHistory.
 *  Already-applied phases are skipped; demo phases are skipped (NOT recorded)
 *  unless `demo` is set, so enabling demo later still applies them. */
export async function runSeeds(
  prisma: PrismaClient,
  seeds: readonly Seed[],
  opts: RunOptions = {},
): Promise<void> {
  const names = new Set<string>();
  for (const seed of seeds) {
    if (names.has(seed.name)) throw new Error(`Duplicate seed name: ${seed.name}`);
    names.add(seed.name);
  }

  const history = await prisma.seedHistory.findMany({ select: { name: true } });
  const applied = new Set(history.map((row) => row.name));

  let ran = 0;
  let baselined = 0;
  let skipped = 0;
  for (const seed of seeds) {
    if (applied.has(seed.name)) {
      console.log(`= ${seed.name} — already applied`);
      continue;
    }
    if (opts.baseline) {
      await prisma.seedHistory.create({ data: { name: seed.name } });
      console.log(`~ ${seed.name} — baselined (marked applied, not run)`);
      baselined++;
      continue;
    }
    if (seed.kind === 'demo' && !opts.demo) {
      console.log(`- ${seed.name} — skipped (demo phase; set SEED_DEMO=true to apply)`);
      skipped++;
      continue;
    }
    console.log(`> ${seed.name} — applying…`);
    await seed.run(prisma);
    await prisma.seedHistory.create({ data: { name: seed.name } });
    ran++;
  }

  console.log(
    `Seed complete: ${ran} applied, ${baselined} baselined, ${skipped} skipped, ` +
      `${applied.size} previously applied.`,
  );
}
