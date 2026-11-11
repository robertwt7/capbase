import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  COMPANY_QUERY_VERSION,
  type SavedSearchItem,
  type CursorPage,
} from '@repo/api';
import type { SavedSearch } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { FullAccessService, type FullAccess } from './full-access.guard';
import { decodeSavedParams, searchName } from './saved-search-query';
import { decodeCursor, encodeCursor } from './pagination';
@Injectable()
export class SavedSearchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fullAccess: FullAccessService,
  ) {}
  async list(
    userId: string,
    limit = 25,
    cursor?: string,
    known?: FullAccess,
  ): Promise<CursorPage<SavedSearchItem>> {
    await this.fullAccess.require(userId, new Date(), known);
    const c = decodeCursor(cursor);
    limit = Math.min(100, Math.max(1, limit));
    const rows = await this.prisma.savedSearch.findMany({
      where: {
        userId,
        ...(c
          ? {
              OR: [
                { createdAt: { lt: c.at } },
                { createdAt: c.at, id: { lt: c.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((r) => this.item(r))),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
  async create(userId: string, name: unknown, params: unknown, known?: FullAccess) {
    await this.fullAccess.require(userId, new Date(), known);
    const query = await decodeSavedParams(params);
    return this.item(
      await this.prisma.savedSearch.create({
        data: {
          userId,
          name: searchName(name),
          version: COMPANY_QUERY_VERSION,
          params: query.params,
        },
      }),
    );
  }
  async rename(userId: string, id: string, name: unknown, known?: FullAccess) {
    await this.fullAccess.require(userId, new Date(), known);
    const changed = await this.prisma.savedSearch.updateMany({
      where: { userId, id },
      data: { name: searchName(name) },
    });
    if (!changed.count) throw new NotFoundException('Search not found');
    return { ok: true };
  }
  async remove(userId: string, id: string, known?: FullAccess) {
    await this.fullAccess.require(userId, new Date(), known);
    if (
      !(await this.prisma.savedSearch.deleteMany({ where: { userId, id } }))
        .count
    )
      throw new NotFoundException('Search not found');
    return { ok: true };
  }
  async decode(search: Pick<SavedSearch, 'params' | 'version'>) {
    if (search.version !== COMPANY_QUERY_VERSION)
      throw new BadRequestException('Unsupported saved search version');
    return (await decodeSavedParams(search.params)).query;
  }
  private async item(row: SavedSearch): Promise<SavedSearchItem> {
    const runnable =
      row.version === COMPANY_QUERY_VERSION &&
      (await decodeSavedParams(row.params).then(
        () => true,
        () => false,
      ));
    return {
      id: row.id,
      name: row.name,
      params: row.params,
      runnable,
      createdAt: row.createdAt.toISOString(),
      monitor: {
        enabled: row.monitoredAt !== null,
        status: row.monitorStatus as SavedSearchItem['monitor']['status'],
      },
    };
  }
}
