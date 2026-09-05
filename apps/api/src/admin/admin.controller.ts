import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IDENTIFIABLE_TYPES,
  MERGE_STATUSES,
  type IdentifiableType,
  type MergeQueueResponse,
  type MergeStatus,
  type PendingSubmissionsResponse,
  type ReviewableType,
  type ReviewStatus,
} from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';
import { ManualMergeCandidateDto, MergeDecisionDto } from './dto/merge.dto';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import { MergeService } from './merge/merge.service';

const REVIEW_STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const REVIEWABLE_TYPES: ReviewableType[] = [
  'company',
  'round',
  'person',
  'investor',
  'acquisition',
  'exit',
  'diversity',
  'proposal',
];

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly merges: MergeService,
  ) {}

  @Get('submissions')
  submissions(@Query('status') status?: string): Promise<PendingSubmissionsResponse> {
    const resolved = (status ?? 'PENDING') as ReviewStatus;
    if (!REVIEW_STATUSES.includes(resolved)) {
      throw new BadRequestException(`Invalid status "${status}"`);
    }
    return this.admin.listSubmissions(resolved);
  }

  @Patch('submissions/:type/:id')
  moderate(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: ModerationDecisionDto,
    @CurrentUser() user: RequestUser,
  ) {
    if (!REVIEWABLE_TYPES.includes(type as ReviewableType)) {
      throw new BadRequestException(`Invalid submission type "${type}"`);
    }
    // The acting admin is recorded on every revision this decision writes.
    return this.admin.moderate(type as ReviewableType, id, dto.status, user.id);
  }

  // --- Merge queue ---------------------------------------------------------

  @Get('merges')
  mergeQueue(
    @Query('status') status?: string,
    @Query('type') type?: string,
  ): Promise<MergeQueueResponse> {
    const resolved = (status ?? 'PENDING') as MergeStatus;
    if (!MERGE_STATUSES.includes(resolved)) {
      throw new BadRequestException(`Invalid status "${status}"`);
    }
    if (type && !IDENTIFIABLE_TYPES.includes(type as IdentifiableType)) {
      throw new BadRequestException(`Invalid entity type "${type}"`);
    }
    return this.merges.listCandidates(resolved, type as IdentifiableType | undefined);
  }

  /** Fold one row of the pair into the other. The loser is tombstoned, not
   *  deleted — see MergeService. */
  @Post('merges/:id/merge')
  mergePair(
    @Param('id') id: string,
    @Body() dto: MergeDecisionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.merges.mergeCandidate(id, dto.survivorId, user.id);
  }

  /** "Not a duplicate" — the pair is kept as REJECTED so no detector proposes
   *  it again. */
  @Post('merges/:id/reject')
  rejectPair(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.merges.reject(id, user.id);
  }

  /** Queue a duplicate the detector missed. */
  @Post('merges/manual')
  queuePair(@Body() dto: ManualMergeCandidateDto) {
    return this.merges.createCandidate(dto.entityType, dto.leftId, dto.rightId);
  }

  @Post('merges/records/:id/unmerge')
  unmerge(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.merges.unmerge(id, user.id);
  }
}
