import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { IdentifiableType, IdentifierScheme } from '@repo/api';

import { AppModule } from './app.module';
import {
  emptyCounts,
  writeIdentifier,
  type IdentifierCounts,
  type IdentifierWriterClient,
} from './ingest/identifier.writer';
import { PrismaService } from './prisma/prisma.service';
import { SBIR } from './sources/sbir/sbir.parser';
import { SEC_EDGAR } from './sources/sec-edgar/sec-edgar.source';
import { SEC_FORM_C } from './sources/sec-form-c/form-c.parser';
import { SEC_S1 } from './sources/sec-s1/sec-s1.source';
import { WIKIDATA } from './sources/wikidata/wikidata.mapper';

const BATCH = 500;

/** Sources whose Company.externalId *is* an SEC Central Index Key. */
const CIK_SOURCES = new Set<string>([SEC_EDGAR, SEC_FORM_C, SEC_S1]);

/** Written on every row this pass mints, so a later run can tell a derived
 *  identifier from one a source or an admin supplied. */
const BACKFILL = 'BACKFILL';

/**
 * One-off CLI: `node dist/backfill-identifiers.js` — populates EntityIdentifier
 * from provenance the database already holds.
 *
 * No network access, exactly like backfill-citations: every value is *derived*
 * from a column already on the row (externalId for the SEC and Wikidata rows,
 * the uei:/duns: prefix SBIR keys firms on, crdNumber/cikNumber on investors,
 * and the domain column on both). Idempotent — a value already recorded for the
 * same entity is a no-op — so it is safe to re-run after each ingest.
 *
 * A value that fails normalizeIdentifier is counted and skipped, never stored.
 * A value already claimed by a *different* row of the same type is the
 * duplicate this feature exists to catch: it records a MergeCandidate instead
 * of overwriting.
 */
async function main() {
  const logger = new Logger('BackfillIdentifiers');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const client = prisma as unknown as IdentifierWriterClient;

    const companies = await backfillCompanies(prisma, client, logger);
    const investors = await backfillInvestors(prisma, client, logger);

    logger.log(
      `Backfill done — companies: ${summarize(companies)}; investors: ${summarize(investors)}`,
    );
  } finally {
    await app.close();
  }
}

/** Every identifier derivable from one company row. */
function companyIdentifiers(row: {
  externalSource: string | null;
  externalId: string | null;
  domain: string;
}): { scheme: IdentifierScheme; value: string }[] {
  const out: { scheme: IdentifierScheme; value: string }[] = [];
  const { externalSource: source, externalId: id } = row;

  if (source && id) {
    if (CIK_SOURCES.has(source)) {
      out.push({ scheme: 'CIK', value: id });
    } else if (source === WIKIDATA) {
      out.push({ scheme: 'WIKIDATA', value: id });
    } else if (source === SBIR) {
      // SBIR keys a firm on UEI → DUNS → normalized name. The first two are
      // identifiers; a normalized name is not, so a `name:` key yields nothing,
      // which is the honest outcome rather than a fabricated identifier.
      if (id.startsWith('uei:')) out.push({ scheme: 'UEI', value: id.slice(4) });
      else if (id.startsWith('duns:')) out.push({ scheme: 'DUNS', value: id.slice(5) });
    }
  }

  if (row.domain) out.push({ scheme: 'DOMAIN', value: row.domain });
  return out;
}

/** Every identifier derivable from one investor row. */
function investorIdentifiers(row: {
  externalSource: string | null;
  externalId: string | null;
  crdNumber: string | null;
  cikNumber: string | null;
  domain: string | null;
}): { scheme: IdentifierScheme; value: string }[] {
  const out: { scheme: IdentifierScheme; value: string }[] = [];
  if (row.crdNumber) out.push({ scheme: 'CRD', value: row.crdNumber });
  if (row.cikNumber) out.push({ scheme: 'CIK', value: row.cikNumber });
  if (row.externalSource === WIKIDATA && row.externalId) {
    out.push({ scheme: 'WIKIDATA', value: row.externalId });
  }
  if (row.domain) out.push({ scheme: 'DOMAIN', value: row.domain });
  return out;
}

async function backfillCompanies(
  prisma: PrismaService,
  client: IdentifierWriterClient,
  logger: Logger,
): Promise<IdentifierCounts> {
  const counts = emptyCounts();
  let scanned = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.company.findMany({
      select: { id: true, externalSource: true, externalId: true, domain: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    scanned += rows.length;

    for (const row of rows) {
      await record(client, counts, 'company', row.id, companyIdentifiers(row));
    }
    logger.log(`Companies: ${scanned} scanned — ${summarize(counts)}`);
  }

  return counts;
}

async function backfillInvestors(
  prisma: PrismaService,
  client: IdentifierWriterClient,
  logger: Logger,
): Promise<IdentifierCounts> {
  const counts = emptyCounts();
  let scanned = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.investor.findMany({
      select: {
        id: true,
        externalSource: true,
        externalId: true,
        crdNumber: true,
        cikNumber: true,
        domain: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    scanned += rows.length;

    for (const row of rows) {
      await record(client, counts, 'investor', row.id, investorIdentifiers(row));
    }
    logger.log(`Investors: ${scanned} scanned — ${summarize(counts)}`);
  }

  return counts;
}

async function record(
  client: IdentifierWriterClient,
  counts: IdentifierCounts,
  entityType: IdentifiableType,
  entityId: string,
  identifiers: { scheme: IdentifierScheme; value: string }[],
): Promise<void> {
  for (const { scheme, value } of identifiers) {
    const outcome = await writeIdentifier(client, {
      scheme,
      value,
      entityType,
      entityId,
      source: BACKFILL,
    });
    counts[outcome]++;
  }
}

function summarize(c: IdentifierCounts): string {
  return `${c.written} written, ${c.unchanged} unchanged, ${c.skipped} skipped (failed validation), ${c.conflict} conflicts (candidates recorded)`;
}

void main().then(() => process.exit(0));
