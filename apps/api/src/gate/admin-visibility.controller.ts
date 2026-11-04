import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import type { AdminVisibilityResponse } from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateContributionWindowDto, UpdateFieldPolicyDto, UpdateSectionPolicyDto } from './dto/visibility.dto';
import { GatePolicyService } from './gate-policy.service';

/** The read gate's settings (`/admin/visibility`). Each write is one row and
 *  reloads the policy before it answers, so the next read already obeys it.
 *  An unknown section or field is a 404; a rule the policy forbids, a 400. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/visibility')
export class AdminVisibilityController {
  constructor(private readonly policy: GatePolicyService) {}

  @Get()
  get(): Promise<AdminVisibilityResponse> {
    return this.policy.adminView();
  }

  @Put('sections/:section')
  setSection(
    @Param('section') section: string,
    @Body() dto: UpdateSectionPolicyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AdminVisibilityResponse> {
    return this.policy.setSection(section, dto, user);
  }

  @Delete('sections/:section')
  @HttpCode(200)
  resetSection(@Param('section') section: string, @CurrentUser() user: RequestUser): Promise<AdminVisibilityResponse> {
    return this.policy.resetSection(section, user);
  }

  @Put('fields/:entity/:field')
  setField(
    @Param('entity') entity: string,
    @Param('field') field: string,
    @Body() dto: UpdateFieldPolicyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AdminVisibilityResponse> {
    return this.policy.setField(entity, field, dto, user);
  }

  @Delete('fields/:entity/:field')
  @HttpCode(200)
  resetField(
    @Param('entity') entity: string,
    @Param('field') field: string,
    @CurrentUser() user: RequestUser,
  ): Promise<AdminVisibilityResponse> {
    return this.policy.resetField(entity, field, user);
  }

  @Put('settings/contribution-window')
  setWindow(@Body() dto: UpdateContributionWindowDto, @CurrentUser() user: RequestUser): Promise<AdminVisibilityResponse> {
    return this.policy.setWindow(dto.days, user);
  }

  @Delete('settings/contribution-window')
  @HttpCode(200)
  resetWindow(@CurrentUser() user: RequestUser): Promise<AdminVisibilityResponse> {
    return this.policy.resetWindow(user);
  }
}
