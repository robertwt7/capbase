import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentAccess, FullAccessGuard, type FullAccess } from '../saved-searches/full-access.guard';
import { pageLimit } from '../saved-searches/pagination';
import { MonitoringService } from './monitoring.service';
import { UpdatesService } from './updates.service';
@Controller('auth/me')
@UseGuards(JwtAuthGuard, FullAccessGuard)
export class MonitoringController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly updates: UpdatesService,
  ) {}
  @Put('saved-searches/:id/monitoring') enableSearch(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Param('id') id: string,
  ) {
    return this.monitoring.setSearch(u.id, id, true, undefined, a);
  }
  @Delete('saved-searches/:id/monitoring') disableSearch(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Param('id') id: string,
  ) {
    return this.monitoring.setSearch(u.id, id, false, undefined, a);
  }
  @Put('saved-companies/:slug/monitoring') enableCompany(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Param('slug') slug: string,
  ) {
    return this.monitoring.setCompany(u.id, slug, true, undefined, a);
  }
  @Delete('saved-companies/:slug/monitoring') disableCompany(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Param('slug') slug: string,
  ) {
    return this.monitoring.setCompany(u.id, slug, false, undefined, a);
  }
  @Get('updates') @Header('Cache-Control', 'no-store') feed(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.updates.list(u.id, pageLimit(limit), cursor, a);
  }
}
