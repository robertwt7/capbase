import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { ReviewableType } from '@repo/api';

import { AdminService } from '../admin/admin.service';
import type { RequestUser } from '../auth/decorators/current-user.decorator';

/**
 * What an API key's scope means for a write. Contributor keys: PENDING, exactly like the
 * website. Admin keys: approved at once through the same `AdminService.moderate` the queue uses
 * — so revisions, citations and PENDING firm/person promotion match a queue approval exactly.
 *
 * Two steps, not one transaction: if the approval throws, the row stays PENDING in the queue
 * (visible, not lost) and the caller gets a 500 naming it.
 */
@Injectable()
export class V1WriteService {
  private readonly logger = new Logger(V1WriteService.name);

  constructor(private readonly admin: AdminService) {}

  async publish<T extends { id: string; moderationStatus: string }>(
    user: RequestUser,
    type: ReviewableType,
    created: T,
  ): Promise<T> {
    if (user.apiKey?.scope !== 'admin') return created;
    try {
      await this.admin.moderate(type, created.id, 'APPROVED', user.id);
    } catch (err) {
      this.logger.error(
        `Admin-key publish of ${type} ${created.id} failed; left PENDING`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new InternalServerErrorException(
        `The ${type} was created (id ${created.id}) but could not be published. ` +
          'It is waiting in the moderation queue.',
      );
    }
    return { ...created, moderationStatus: 'APPROVED' };
  }
}
