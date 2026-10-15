import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { REVIEWABLE_TYPES, type PendingSubmissionsResponse, type ReviewableType } from '@repo/api';

import { AdminService } from '../admin/admin.service';
import { parseReviewableType, parseReviewStatus } from '../admin/submission-params';
import { AdminKey } from '../auth/decorators/api-key.decorator';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { V1ReadThrottle, V1WriteThrottle } from '../throttle/throttle';
import { V1RejectDto } from './dto/v1-reject.dto';
import { V1ListSubmissionsDto } from './dto/v1-submissions.dto';

/**
 * The moderation queue over /v1, for admin keys only: list, approve, reject. Nothing else an
 * admin can do (merges, bans, roles, suppression) is exposed here — those stay in /admin.
 */
const TYPE_PARAM = { name: 'type', enum: [...REVIEWABLE_TYPES] };
const DECIDED = {
  description: '`{ id, type, moderationStatus }`.',
  schema: {
    example: { id: 'cm1…', type: 'company', moderationStatus: 'APPROVED' },
  },
};

@ApiTags('Moderation (admin keys)')
@AdminKey()
@Controller('v1/submissions')
export class V1AdminController {
  constructor(private readonly admin: AdminService) {}

  /** One page of the queue, newest first. Pass `nextCursor` back as `before`. */
  @ApiOperation({ summary: 'List the moderation queue' })
  @ApiOkResponse({
    description: '`{ total, countsByType, items, nextCursor }`.',
  })
  @V1ReadThrottle()
  @Get()
  list(@Query() query: V1ListSubmissionsDto): Promise<PendingSubmissionsResponse> {
    return this.admin.listSubmissions(
      parseReviewStatus(query.status),
      parseReviewableType(query.type),
      query.before,
    );
  }

  @ApiOperation({
    summary: 'Approve a submission',
    description: 'Publishes it and emails the contributor.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiOkResponse(DECIDED)
  @ApiNotFoundResponse({
    description: 'No submission of this type has this id.',
  })
  @V1WriteThrottle()
  @HttpCode(200)
  @Post(':type/:id/approve')
  approve(@Param('type') type: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.admin.moderate(requireType(type), id, 'APPROVED', user.id);
  }

  @ApiOperation({
    summary: 'Reject a submission',
    description: 'The optional `note` is quoted in the email to the contributor and not stored.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiOkResponse(DECIDED)
  @ApiNotFoundResponse({
    description: 'No submission of this type has this id.',
  })
  @V1WriteThrottle()
  @HttpCode(200)
  @Post(':type/:id/reject')
  reject(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: V1RejectDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.admin.moderate(requireType(type), id, 'REJECTED', user.id, dto.note);
  }
}

function requireType(type: string): ReviewableType {
  const resolved = parseReviewableType(type);
  if (!resolved) throw new BadRequestException('Missing submission type');
  return resolved;
}
