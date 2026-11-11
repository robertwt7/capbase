import { Injectable } from '@nestjs/common';
import {
  gateLimit,
  type CursorPage,
  type MonitorUpdate,
  type ViewerAccess,
  type GatePolicy,
} from '@repo/api';
import type { MonitorEvent } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { FullAccessService, type FullAccess } from '../saved-searches/full-access.guard';
import { GatePolicyService } from '../gate/gate-policy.service';
import {
  COMPANY_BLANKS,
  ROUND_BLANKS,
  gateFields,
  gateRowFields,
  publicRowsWhere,
} from '../gate/gate';
import { toCompany, toFundingRound } from '../companies/company.mapper';
import { decodeCursor, encodeCursor } from '../saved-searches/pagination';
import { MAX_MERGE_HOPS } from '../prisma/public-filters';
@Injectable()
export class UpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fullAccess: FullAccessService,
    private readonly gates: GatePolicyService,
  ) {}
  async list(
    userId: string,
    limit = 25,
    cursor?: string,
    known?: FullAccess,
  ): Promise<CursorPage<MonitorUpdate>> {
    const { access } = await this.fullAccess.require(userId, new Date(), known);
    const policy = this.gates.current();
    const c = decodeCursor(cursor);
    limit = Math.min(100, Math.max(1, limit));
    const rows = await this.prisma.monitorEvent.findMany({
      where: {
        userId,
        ...(c
          ? {
              OR: [
                { observedAt: { lt: c.at } },
                { observedAt: c.at, id: { lt: c.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.resolve(userId, page, access, policy),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.observedAt, last.id)
          : null,
    };
  }
  /** Feed and digest share one batched, viewer-aware resolver. */
  async resolve(
    userId: string,
    events: MonitorEvent[],
    access: ViewerAccess,
    policy: GatePolicy,
  ): Promise<MonitorUpdate[]> {
    if (!access.unlocked) return [];
    const owned = events.filter((e) => e.userId === userId);
    if (!owned.length) return [];
    const rounds =
      gateLimit('companyRounds', access, policy) === Infinity
        ? await this.prisma.fundingRound.findMany({
            where: {
              id: { in: owned.flatMap((e) => (e.roundId ? [e.roundId] : [])) },
              moderationStatus: 'APPROVED',
              kind: { in: ['Equity', 'Debt'] },
              ...publicRowsWhere(access, policy, 'companyRounds'),
            },
            include: {
              investors: {
                where: publicRowsWhere(access, policy, 'companyRounds'),
              },
            },
          })
        : [];
    const byRound = new Map(rounds.map((r) => [r.id, r]));
    const searches = await this.prisma.savedSearch.findMany({
      where: {
        id: { in: owned.flatMap((e) => (e.searchId ? [e.searchId] : [])) },
        userId,
        monitoredAt: { not: null },
        monitorStatus: 'active',
      },
    });
    const bySearch = new Map(searches.map((s) => [s.id, s]));
    const ids = [
      ...new Set(
        owned
          .map((e) =>
            e.roundId ? byRound.get(e.roundId)?.companyId : e.companyId,
          )
          .filter((id): id is string => !!id),
      ),
    ];
    const companies = await this.prisma.company.findMany({
      where: { id: { in: ids } },
    });
    const byCompany = new Map(companies.map((c) => [c.id, c]));
    // Resolve tombstone chains in batches, bounded to the same hop limit as profile links.
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const missing = [
        ...new Set(
          [...byCompany.values()].flatMap((c) =>
            c.mergedIntoId && !byCompany.has(c.mergedIntoId)
              ? [c.mergedIntoId]
              : [],
          ),
        ),
      ];
      if (!missing.length) break;
      for (const company of await this.prisma.company.findMany({
        where: { id: { in: missing } },
      }))
        byCompany.set(company.id, company);
    }
    const canonical = (id: string) => {
      let row = byCompany.get(id);
      for (let hop = 0; row?.mergedIntoId && hop < MAX_MERGE_HOPS; hop++)
        row = byCompany.get(row.mergedIntoId);
      return row && !row.mergedIntoId && row.moderationStatus === 'APPROVED'
        ? row
        : null;
    };
    const saves = await this.prisma.savedCompany.findMany({
      where: {
        userId,
        companyId: { in: [...byCompany.keys()] },
        monitoredAt: { not: null },
        monitorStatus: 'active',
      },
    });
    const monitored = new Set(saves.map((s) => s.companyId));
    const items: MonitorUpdate[] = [];
    // A merge can leave one search with events for both the loser and the survivor; both
    // resolve to the survivor, so show it once (events arrive newest first).
    const shownMatches = new Set<string>();
    for (const event of owned) {
      const round = event.roundId ? byRound.get(event.roundId) : null;
      const company = canonical(round?.companyId ?? event.companyId);
      if (!company) continue;
      const matchKey = `${event.searchId}/${company.id}`;
      if (event.kind === 'match' && shownMatches.has(matchKey)) continue;
      const search = event.searchId ? bySearch.get(event.searchId) : null;
      if (
        event.kind === 'match' &&
        (!search || event.observedAt < search.monitoredAt!)
      )
        continue;
      if (event.kind === 'funding' && (!round || !monitored.has(company.id)))
        continue;
      const mapped = gateFields(
        'company',
        toCompany(company),
        company.partnerFields,
        access,
        policy,
        COMPANY_BLANKS,
      );
      const funding = round
        ? gateRowFields(
            toFundingRound(round),
            round.partnerFields,
            access,
            policy,
            'companyRounds',
            ROUND_BLANKS,
          )
        : null;
      if (
        funding?.masked?.some((k) =>
          ['kind', 'date', 'name', 'amountUsd'].includes(k),
        )
      )
        continue;
      if (event.kind === 'match') shownMatches.add(matchKey);
      items.push({
        id: event.id,
        kind: event.kind as MonitorUpdate['kind'],
        company: mapped,
        round: funding,
        search: search
          ? {
              name: search.name,
              path: search.params
                ? `/companies?${search.params}`
                : '/companies',
            }
          : null,
        observedAt: event.observedAt.toISOString(),
      });
    }
    return items;
  }
}
