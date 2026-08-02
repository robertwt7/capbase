import type { PrismaClient } from '../../src/generated/prisma/client';

import type { Seed } from './types';

/** Kebab-case slug, matching the shape the ingest jobs mint. */
function kebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Links the demo dataset's investor rows to first-class Investor records.
 *
 * Phase 002 shipped before the Investor table existed and seed phases are
 * immutable, so it still writes InvestorHolding/RoundInvestor rows with a null
 * investorId. On a database created after the add_investor_entity migration,
 * that migration's backfill has nothing to act on (002 runs afterwards), so this
 * phase performs the same resolution in TypeScript.
 *
 * Idempotent: it only ever fills a null investorId, and finds an existing
 * Investor by name before creating one.
 */
export const demoInvestors: Seed = {
  name: '003-demo-investors',
  kind: 'demo',
  async run(prisma: PrismaClient) {
    const holdings = await prisma.investorHolding.findMany({
      where: { investorId: null },
      select: { id: true, name: true, type: true, websiteUrl: true, linkedinUrl: true },
    });
    const positions = await prisma.roundInvestor.findMany({
      where: { investorId: null },
      select: { id: true, name: true },
    });
    if (holdings.length === 0 && positions.length === 0) return;

    // Existing slugs, so a new investor never collides with one already stored.
    const slugs = new Set((await prisma.investor.findMany({ select: { slug: true } })).map((i) => i.slug));
    const byName = new Map(
      (await prisma.investor.findMany({ select: { id: true, name: true } })).map((i) => [i.name, i.id]),
    );

    const resolve = async (
      name: string,
      facts: { type?: string; websiteUrl?: string | null; linkedinUrl?: string | null } = {},
    ): Promise<string | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = byName.get(trimmed);
      if (existing) return existing;

      const base = kebab(trimmed);
      if (!base) return null;
      let slug = base;
      for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
      slugs.add(slug);

      const created = await prisma.investor.create({
        data: {
          slug,
          name: trimmed,
          type: facts.type ?? 'Venture',
          websiteUrl: facts.websiteUrl ?? null,
          linkedinUrl: facts.linkedinUrl ?? null,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      });
      byName.set(trimmed, created.id);
      return created.id;
    };

    for (const h of holdings) {
      const investorId = await resolve(h.name, {
        type: h.type,
        websiteUrl: h.websiteUrl,
        linkedinUrl: h.linkedinUrl,
      });
      if (investorId) {
        await prisma.investorHolding.update({ where: { id: h.id }, data: { investorId } });
      }
    }

    for (const p of positions) {
      const investorId = await resolve(p.name);
      if (investorId) {
        await prisma.roundInvestor.update({ where: { id: p.id }, data: { investorId } });
      }
    }
  },
};
