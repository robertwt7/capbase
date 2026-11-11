import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AdminClaim, AdminClaimPage } from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClaimsService } from './claims.service';
import { ClaimDecisionDto, ListAdminClaimsDto } from './dto/claim.dto';

/** `/admin/claims`: manual requests to decide, active claims to revoke. Its own controller so
 *  AdminController doesn't grow another dependency; same guards, same `/admin` prefix. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/claims')
export class AdminClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  list(@Query() query: ListAdminClaimsDto): Promise<AdminClaimPage> {
    return this.claims.adminList(query.status ?? 'pending', query.page ?? 1);
  }

  /** A bare count of open manual requests, for the admin nav. */
  @Get('count')
  async count(): Promise<{ pending: number }> {
    return { pending: await this.claims.pendingCount() };
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() admin: RequestUser): Promise<AdminClaim> {
    return this.claims.approve(id, admin.id);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() admin: RequestUser,
    @Body() dto: ClaimDecisionDto,
  ): Promise<AdminClaim> {
    return this.claims.reject(id, admin.id, dto.note);
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string, @CurrentUser() admin: RequestUser): Promise<AdminClaim> {
    return this.claims.revoke(id, admin.id);
  }
}
