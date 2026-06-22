import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PendingSubmissionsResponse, ReviewableType, ReviewStatus } from '@repo/api';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';

const REVIEW_STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const REVIEWABLE_TYPES: ReviewableType[] = [
  'company',
  'round',
  'person',
  'investor',
  'acquisition',
  'exit',
  'diversity',
];

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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
  ) {
    if (!REVIEWABLE_TYPES.includes(type as ReviewableType)) {
      throw new BadRequestException(`Invalid submission type "${type}"`);
    }
    return this.admin.moderate(type as ReviewableType, id, dto.status);
  }
}
