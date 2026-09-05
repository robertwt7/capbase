import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { IdentifiableType, MergeSignal } from '@repo/api';

import { AppModule } from './app.module';
import { recordCandidate, type IdentifierWriterClient } from './ingest/identifier.writer';
import { GROUP_LIMIT, detectorNameKey, sweep, type DetectRow } from './ingest/merge-detector';
import { PrismaService } from './prisma/prisma.service';

/**
 * One-off CLI: `node dist/detect-merges.js` — proposes duplicate pairs from the
 * two *weak* signals.
 *
 * The identifier signal is deliberately absent: with EntityIdentifier unique
 * per (scheme, value, entityType) a duplicate identifier can never land in the
 * table, so there is nothing here for a scan to find. `writeIdentifier` records
 * those candidates at the moment the write fails, which is the only moment they
 * are visible.
 *
 * Both sweeps write through `recordCandidate`, so canonical id ordering, signal
 * upgrading and the already-decided guard are shared with the identifier path —
 * a pair an admin rejected is never re-proposed.
 */
async function main() {
  const logger = new Logger('DetectMerges');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const client = prisma as unknown as IdentifierWriterClient;

    // Tombstoned rows are excluded: a row already merged away is not a
    // candidate for merging again, and proposing it would undo the decision.
    const companies: DetectRow[] = await prisma.company.findMany({
      where: { mergedIntoId: null },
      select: { id: true, name: true, domain: true },
    });
    const investors: DetectRow[] = await prisma.investor.findMany({
      where: { mergedIntoId: null },
      select: { id: true, name: true, domain: true },
    });

    logger.log(`Scanning ${companies.length} companies and ${investors.length} investors`);

    let total = 0;
    total += await run(client, logger, 'company', 'domain', companies, (r) => r.domain ?? '');
    total += await run(client, logger, 'investor', 'domain', investors, (r) => r.domain ?? '');
    // The name key is TypeScript, not SQL, so the grouping happens in memory.
    // 43k {id, name} rows is a few MB for one CLI invocation. It is looser than
    // the matcher's own key on purpose — see detectorNameKey.
    const nameKey = (r: DetectRow) => detectorNameKey(r.name);
    total += await run(client, logger, 'company', 'name', companies, nameKey);
    total += await run(client, logger, 'investor', 'name', investors, nameKey);

    logger.log(`Detection done: ${total} candidate pairs recorded or upgraded`);
  } finally {
    await app.close();
  }
}

async function run(
  client: IdentifierWriterClient,
  logger: Logger,
  entityType: IdentifiableType,
  signal: Extract<MergeSignal, 'domain' | 'name'>,
  rows: DetectRow[],
  key: (row: DetectRow) => string,
): Promise<number> {
  const { pairs, skipped } = sweep(rows, key, GROUP_LIMIT);

  for (const pair of pairs) {
    await recordCandidate(client, {
      entityType,
      aId: pair.aId,
      bId: pair.bId,
      signal,
      evidence: pair.evidence,
    });
  }

  const skippedNote = skipped.length
    ? ` — skipped ${skipped.length} group(s) over ${GROUP_LIMIT}: ` +
      skipped
        .sort((a, b) => b.size - a.size)
        .slice(0, 5)
        .map((g) => `"${g.key}" (${g.size})`)
        .join(', ')
    : '';
  logger.log(`${entityType}/${signal}: ${pairs.length} pairs${skippedNote}`);
  return pairs.length;
}

void main().then(() => process.exit(0));
