// Must stay the first import — see instrument.ts.
import './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { IngestLock } from './ingest/ingest-lock';
import { humanVerticalCompanyIds, planVerticals } from './ingest/verticals';
import { PrismaService } from './prisma/prisma.service';

const PAGE = 2_000;

interface Counts {
  scanned: number;
  updated: number;
  human: number;
  unmapped: number;
}

// One-off CLI: `node dist/backfill-verticals.js` (`make backfill-verticals[-prod]`) — derives
// Company.verticals from the stored industry labels for every approved, unmerged company, and
// sets the `'verticals'` partner mark exactly when they came from partner-marked labels. No
// network. Idempotent: only rows whose verticals or mark change are written, so a second run
// writes 0; re-run it after any mapping change. Never touches a company whose verticals a human
// owns (an approved edit set them), writes no revisions and does not bump `updatedAt` (a derived
// value is not an edit, and `updatedAt` drives sitemap `lastmod`). Holds the ingest lock, because
// ingest writes the same column.
async function backfill(prisma: PrismaService, logger: Logger): Promise<Counts> {
  const human = await humanVerticalCompanyIds(prisma);
  const counts: Counts = { scanned: 0, updated: 0, human: 0, unmapped: 0 };
  let cursor = '';

  for (;;) {
    const rows = await prisma.$queryRaw<
      { id: string; verticals: string[]; industry: string[]; partnerFields: string[] }[]
    >`
      SELECT id, verticals, industry, "partnerFields" FROM "Company"
       WHERE "moderationStatus" = 'APPROVED' AND "mergedIntoId" IS NULL AND id > ${cursor}
       ORDER BY id
       LIMIT ${PAGE}`;
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    counts.scanned += rows.length;

    const updates: { id: string; v: string[]; pf: string[] | null }[] = [];
    for (const row of rows) {
      if (human.has(row.id)) {
        counts.human++;
        continue;
      }
      const plan = planVerticals(row, row.partnerFields.includes('industry'));
      if (row.industry.length > 0 && (plan ? plan.verticals : row.verticals).length === 0)
        counts.unmapped++;
      if (plan) updates.push({ id: row.id, v: plan.verticals, pf: plan.partnerFields ?? null });
    }

    if (updates.length > 0) {
      counts.updated += await prisma.$executeRaw`
        UPDATE "Company" c
           SET "verticals" = u.v,
               "partnerFields" = COALESCE(u.pf, c."partnerFields")
          FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS u(id text, v text[], pf text[])
         WHERE c.id = u.id`;
    }
    logger.log(`Progress: ${counts.updated} updated / ${counts.scanned} scanned`);
  }
  return counts;
}

async function main() {
  const logger = new Logger('BackfillVerticals');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const locked = await app
      .get(IngestLock)
      .runExclusive('backfill-verticals', () => backfill(prisma, logger));
    if (!locked.ran) {
      logger.error('Another ingest holds the lock (the cron?) — retry when it finishes');
      process.exitCode = 75; // EX_TEMPFAIL
      return;
    }
    const c = locked.result;
    logger.log(
      `Backfill done: scanned ${c.scanned} / updated ${c.updated} / skipped (human) ${c.human} / unmapped ${c.unmapped}`,
    );
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    new Logger('BackfillVerticals').error(`Backfill failed: ${String(err)}`);
    process.exit(1);
  },
);
