import type { CitableType, Citation, SourceType } from '@repo/api';
import type { Citation as DbCitation, Source as DbSource } from '@repo/db';

type DbCitationWithSource = DbCitation & { source: DbSource };

/** Maps a Citation row (with its Source joined) to the shared type. The source
    is inlined rather than referenced by id: the client renders it directly and
    a page's citations rarely share enough rows for a lookup table to pay off. */
export function toCitation(row: DbCitationWithSource): Citation {
  return {
    id: row.id,
    entityType: row.entityType as CitableType,
    entityId: row.entityId,
    field: row.field,
    note: row.note,
    source: {
      url: row.source.url,
      sourceType: row.source.sourceType as SourceType,
      title: row.source.title,
      publisher: row.source.publisher,
      reference: row.source.reference,
      retrievedAt: row.source.retrievedAt.toISOString(),
    },
  };
}
