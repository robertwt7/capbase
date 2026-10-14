import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { GEOGRAPHY_SOURCES, deriveCountry, trailingSegment } from './ingest/derive-country';
import { PrismaService } from './prisma/prisma.service';

const BATCH = 1000;

/** How many unrecognised trailing segments to print — enough to spot a
 *  missing alias, few enough to read. */
const TOP_UNKNOWN = 20;

interface Row {
  id: string;
  hq: string | null;
  externalSource: string | null;
}

/** Per-source tallies, logged at the end so a mapping gap is visible. */
interface Tally {
  derived: number;
  unknown: number;
}

/**
 * One-off CLI: `node dist/backfill-geography.js` — fills `countryCode` on
 * Company and Investor rows ingested before the column existed, from what each
 * source already stored in `hq` (rules: ingest/derive-country.ts).
 *
 * No network. Idempotent: only rows with `countryCode IS NULL` are read, so a
 * second run derives nothing new and a value a source wrote is never replaced.
 * Writes no Revision rows — country is a derived classification of a stored
 * string, the same stance `backfill-sectors` takes.
 */
async function main() {
  const logger = new Logger('BackfillGeography');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const sources = [...GEOGRAPHY_SOURCES];

    await backfill(logger, 'Company', sources, {
      page: (after) =>
        prisma.company.findMany({
          where: {
            countryCode: null,
            externalSource: { in: sources },
            ...(after ? { id: { gt: after } } : {}),
          },
          select: { id: true, hq: true, externalSource: true },
          orderBy: { id: 'asc' },
          take: BATCH,
        }),
      write: (ids, countryCode) =>
        prisma.company.updateMany({ where: { id: { in: ids }, countryCode: null }, data: { countryCode } }),
    });

    await backfill(logger, 'Investor', sources, {
      page: (after) =>
        prisma.investor.findMany({
          where: {
            countryCode: null,
            externalSource: { in: sources },
            ...(after ? { id: { gt: after } } : {}),
          },
          select: { id: true, hq: true, externalSource: true },
          orderBy: { id: 'asc' },
          take: BATCH,
        }),
      write: (ids, countryCode) =>
        prisma.investor.updateMany({ where: { id: { in: ids }, countryCode: null }, data: { countryCode } }),
    });
  } finally {
    await app.close();
  }
}

/** Cursor-page one table by id (a filter on the column being written would
 *  shift under an offset), writing one `updateMany` per derived code per page. */
async function backfill(
  logger: Logger,
  table: string,
  sources: string[],
  io: {
    page: (after: string | undefined) => Promise<Row[]>;
    write: (ids: string[], countryCode: string) => Promise<{ count: number }>;
  },
): Promise<void> {
  const tallies = new Map<string, Tally>(sources.map((s) => [s, { derived: 0, unknown: 0 }]));
  const unknownSegments = new Map<string, number>();
  let scanned = 0;
  let written = 0;
  let after: string | undefined;

  for (;;) {
    const rows = await io.page(after);
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.id;
    scanned += rows.length;

    const byCode = new Map<string, string[]>();
    for (const row of rows) {
      const source = row.externalSource ?? '';
      const tally = tallies.get(source) ?? { derived: 0, unknown: 0 };
      tallies.set(source, tally);

      const code = deriveCountry(row.externalSource, row.hq);
      if (!code) {
        tally.unknown++;
        const key = `${source}: ${trailingSegment(row.hq) || '(blank)'}`;
        unknownSegments.set(key, (unknownSegments.get(key) ?? 0) + 1);
        continue;
      }
      tally.derived++;
      const ids = byCode.get(code);
      if (ids) ids.push(row.id);
      else byCode.set(code, [row.id]);
    }

    for (const [code, ids] of byCode) {
      written += (await io.write(ids, code)).count;
    }
    logger.log(`${table}: ${written} written / ${scanned} scanned`);
  }

  for (const [source, t] of tallies) {
    if (t.derived || t.unknown) {
      logger.log(`${table} ${source}: ${t.derived} derived, ${t.unknown} unknown`);
    }
  }
  const top = [...unknownSegments.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_UNKNOWN);
  if (top.length) {
    logger.log(
      `${table} — top unrecognised trailing segments: ${top.map(([k, n]) => `"${k}" ×${n}`).join(', ')}`,
    );
  }
  logger.log(`${table} done: ${written} countries filled across ${scanned} rows without one`);
}

void main().then(() => process.exit(0));
