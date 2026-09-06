import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import {
  recordCandidate,
  writeIdentifier,
  type IdentifierWriterClient,
} from './ingest/identifier.writer';
import { GROUP_LIMIT } from './ingest/merge-detector';
import {
  assignPeople,
  variantPairs,
  type AssignedRole,
  type BackfillRole,
  type ExistingPeople,
} from './ingest/person-matcher';
import { PrismaService } from './prisma/prisma.service';

const BATCH = 500;

/** Written on every identifier this pass mints, so a later run can tell a
 *  derived identifier from one a source or an admin supplied. */
const BACKFILL = 'BACKFILL';

/**
 * One-off CLI: `node dist/backfill-people.js` — collapses the `PersonRole` rows
 * into one `Person` per human.
 *
 * No network access, exactly like backfill-identifiers and backfill-citations:
 * the only identifier a source publishes for a human is the Wikidata QID, and
 * that is already embedded in the row's `externalId`
 * (`${companyQid}:person:${personQid}:${role}`).
 *
 * Dedup is identifier, then exact normalized full name — see `assignPeople`.
 * Name VARIANTS are never merged automatically; they become `MergeCandidate`
 * rows for a human, through the same writer the identifier path uses, so
 * canonical ordering, signal upgrading and the already-decided guard stay in
 * one place.
 *
 * Idempotent: a role that already carries a `personId` is left alone, and a
 * second run therefore creates nothing.
 */
async function main() {
  const logger = new Logger('BackfillPeople');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const client = prisma as unknown as IdentifierWriterClient;

    const existing = await loadExisting(prisma, logger);
    const roles = await loadRoles(prisma, logger);

    const plan = assignPeople(roles, existing);
    logger.log(
      `Planned ${plan.created.length} new people; ${plan.attached.size} roles attach to ` +
        `existing ones, ${plan.skipped} already resolved, ${plan.unusable} unusable names, ` +
        `${plan.suppressed} left unresolved (person suppressed), ` +
        `${plan.malformedQids} malformed QIDs fell through to the name pass`,
    );

    // ref → the real id, once the row exists.
    const ids = new Map<string, string>();
    let written = 0;
    for (const person of plan.created) {
      const row = await prisma.person.create({
        data: {
          slug: person.slug,
          name: person.name,
          normalizedName: person.normalizedName,
          moderationStatus: person.approved ? 'APPROVED' : 'PENDING',
        },
        select: { id: true },
      });
      ids.set(person.ref, row.id);

      if (person.qid) {
        await writeIdentifier(client, {
          scheme: 'WIKIDATA',
          value: person.qid,
          entityType: 'person',
          entityId: row.id,
          source: BACKFILL,
        });
      }

      // One update per person, not per role: a person at 75 SPVs is one query.
      await prisma.personRole.updateMany({
        where: { id: { in: person.roleIds } },
        data: { personId: row.id },
      });

      written++;
      if (written % BATCH === 0) logger.log(`Progress: ${written}/${plan.created.length} people`);
    }

    // Roles that matched a person already in the table, grouped so the update
    // count is one per person rather than one per role.
    const byPerson = new Map<string, string[]>();
    for (const [roleId, personId] of plan.attached) {
      const list = byPerson.get(personId);
      if (list) list.push(roleId);
      else byPerson.set(personId, [roleId]);
    }
    for (const [personId, roleIds] of byPerson) {
      await prisma.personRole.updateMany({ where: { id: { in: roleIds } }, data: { personId } });
    }

    // --- variant candidates -------------------------------------------------
    const assigned: AssignedRole[] = [];
    for (const role of roles) {
      const personId =
        role.personId ??
        plan.attached.get(role.id) ??
        ids.get(plan.assignedRefs.get(role.id) ?? '');
      if (personId) assigned.push({ personId, orgId: role.orgId, name: role.name });
    }

    const { pairs, skipped } = variantPairs(assigned, GROUP_LIMIT);
    for (const pair of pairs) {
      await recordCandidate(client, {
        entityType: 'person',
        aId: pair.aId,
        bId: pair.bId,
        signal: 'name',
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

    logger.log(
      `Backfill done: ${written} people created, ${plan.attached.size} roles attached to ` +
        `existing people, ${plan.skipped} skipped, ${plan.unusable} unusable, ` +
        `${plan.suppressed} suppressed, ` +
        `${pairs.length} variant candidates${skippedNote}`,
    );
  } finally {
    await app.close();
  }
}

/** Everything the matcher already holds: person QIDs from the crosswalk, plus
 *  the names and slugs of the people themselves. Tombstoned and suppressed rows
 *  are excluded from the match maps — attaching a role to a merged-away or
 *  removed person would undo the decision — but their SLUGS stay reserved, so a
 *  new person can never take one and silently inherit its URL. */
async function loadExisting(prisma: PrismaService, logger: Logger): Promise<ExistingPeople> {
  const people = await prisma.person.findMany({
    select: {
      id: true,
      slug: true,
      normalizedName: true,
      mergedIntoId: true,
      suppressedAt: true,
    },
  });

  const live = new Set<string>();
  const existing: ExistingPeople = {
    byQid: new Map(),
    byName: new Map(),
    slugs: new Set(),
    suppressed: new Set(),
  };
  for (const p of people) {
    existing.slugs.add(p.slug);
    if (p.suppressedAt) {
      // Recorded, not just skipped: the name pass must refuse it outright, or
      // it would mint a second row for a human who asked to be removed.
      if (p.normalizedName) existing.suppressed.add(p.normalizedName);
      continue;
    }
    if (p.mergedIntoId) continue;
    live.add(p.id);
    if (p.normalizedName && !existing.byName.has(p.normalizedName)) {
      existing.byName.set(p.normalizedName, p.id);
    }
  }

  const identifiers = await prisma.entityIdentifier.findMany({
    where: { entityType: 'person', scheme: 'WIKIDATA' },
    select: { value: true, entityId: true },
  });
  for (const i of identifiers) {
    if (live.has(i.entityId)) existing.byQid.set(i.value, i.entityId);
  }

  logger.log(
    `Loaded ${people.length} existing people (${existing.byQid.size} with a QID, ` +
      `${existing.byName.size} matchable by name)`,
  );
  return existing;
}

/** Every role row, in keyset pages. Held in memory as one list because the
 *  variant sweep groups across the whole table — 42k small objects, the same
 *  order as the merge detector's own load. */
async function loadRoles(prisma: PrismaService, logger: Logger): Promise<BackfillRole[]> {
  const out: BackfillRole[] = [];
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.personRole.findMany({
      select: {
        id: true,
        name: true,
        companyId: true,
        investorId: true,
        externalSource: true,
        externalId: true,
        personId: true,
        moderationStatus: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      out.push({
        id: row.id,
        name: row.name,
        orgId: row.companyId ?? row.investorId,
        externalSource: row.externalSource,
        externalId: row.externalId,
        personId: row.personId,
        approved: row.moderationStatus === 'APPROVED',
      });
    }
  }

  logger.log(`Loaded ${out.length} role rows`);
  return out;
}

void main().then(() => process.exit(0));
