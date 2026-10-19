import type { Logger } from '@nestjs/common';
import { refreshDirectoryCounts, type DirectoryCountScope } from '@repo/db';
import * as Sentry from '@sentry/nestjs';

import type { PrismaService } from '../prisma/prisma.service';

/** Recompute the directory sort keys a decision touched. Runs after the decision
 *  commits and never throws: a failure only leaves the list order stale until the
 *  next ingest's full pass, so it is logged and reported, never surfaced. */
export async function refreshCountsSafely(
  prisma: PrismaService,
  scope: DirectoryCountScope,
  logger: Logger,
): Promise<void> {
  try {
    await refreshDirectoryCounts(prisma, scope);
  } catch (err) {
    logger.error(
      'Failed to refresh the directory sort counts after a decision',
      err instanceof Error ? err.stack : String(err),
    );
    Sentry.captureException(err, { tags: { admin: 'directory-counts' } });
  }
}
