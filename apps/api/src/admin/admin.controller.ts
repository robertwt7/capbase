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
  REVIEWABLE_TYPES,
  type IdentifiableType,
  type MergeQueueResponse,
  type AdminUser,
  type MergeStatus,
  type Paginated,
  type PendingSubmissionsResponse,
  type ReviewableType,
  type ReviewStatus,
} from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PeopleService } from '../people/people.service';
import { AdminService } from './admin.service';
import { ListUsersDto, UpdateUserDto } from './dto/admin-users.dto';
import { ManualMergeCandidateDto, MergeDecisionDto } from './dto/merge.dto';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import { MergeService } from './merge/merge.service';
import { AdminUsersService } from './users/admin-users.service';

const REVIEW_STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly merges: MergeService,
    private readonly people: PeopleService,
    private readonly users: AdminUsersService,
  ) {}

  @Get('submissions')
  submissions(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('before') before?: string,
  ): Promise<PendingSubmissionsResponse> {
    const resolved = (status ?? 'PENDING') as ReviewStatus;
    if (!REVIEW_STATUSES.includes(resolved)) {
      throw new BadRequestException(`Invalid status "${status}"`);
    }
    if (type !== undefined && !REVIEWABLE_TYPES.includes(type as ReviewableType)) {
      throw new BadRequestException(`Invalid type "${type}"`);
    }
    return this.admin.listSubmissions(resolved, type as ReviewableType | undefined, before);
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
    // The acting admin is recorded on every revision this decision writes; the
    // note only travels in the contributor's rejection email.
    return this.admin.moderate(type as ReviewableType, id, dto.status, user.id, dto.note);
  }

  // --- Merge queue ---------------------------------------------------------

  @Get('merges')
  mergeQueue(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
  ): Promise<MergeQueueResponse> {
    const resolved = (status ?? 'PENDING') as MergeStatus;
    if (!MERGE_STATUSES.includes(resolved)) {
      throw new BadRequestException(`Invalid status "${status}"`);
    }
    if (type && !IDENTIFIABLE_TYPES.includes(type as IdentifiableType)) {
      throw new BadRequestException(`Invalid entity type "${type}"`);
    }
    const n = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException(`Invalid page "${page}"`);
    }
    return this.merges.listCandidates(resolved, type as IdentifiableType | undefined, n);
  }

  /** The nav badge's count, without rendering a page of candidates. */
  @Get('merges/count')
  async mergeCount(@Query('status') status?: string): Promise<{ total: number }> {
    const resolved = (status ?? 'PENDING') as MergeStatus;
    if (!MERGE_STATUSES.includes(resolved)) {
      throw new BadRequestException(`Invalid status "${status}"`);
    }
    return { total: await this.merges.countCandidates(resolved) };
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

  // --- Users ---------------------------------------------------------------

  @Get('users')
  listUsers(@Query() query: ListUsersDto): Promise<Paginated<AdminUser>> {
    return this.users.list(query);
  }

  /** Ban/unban and change role. Banning also rejects the user's pending queue. */
  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AdminUser> {
    return this.users.update(id, dto, user.id);
  }

  // --- Privacy -------------------------------------------------------------

  /**
   * Remove a person from the public surface on request — the operational half
   * of the privacy policy's §6 promise.
   *
   * A dedicated column, not `moderationStatus: 'REJECTED'`: ingest auto-approves
   * every row it touches, so a rejection would be undone by the next cron run.
   * The suppressed person 404s rather than 301s — a redirect would confirm they
   * exist, which is the opposite of what the request asks for.
   */
  @Post('people/:id/suppress')
  suppressPerson(@Param('id') id: string) {
    return this.people.setSuppressed(id, true);
  }

  @Post('people/:id/unsuppress')
  unsuppressPerson(@Param('id') id: string) {
    return this.people.setSuppressed(id, false);
  }
}
