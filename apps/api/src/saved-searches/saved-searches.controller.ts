import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentAccess, FullAccessGuard, type FullAccess } from './full-access.guard';
import { pageLimit } from './pagination';
import { SavedSearchesService } from './saved-searches.service';
function input(body: unknown, keys: string[]): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !keys.includes(k))
  )
    throw new BadRequestException('Invalid saved search fields');
  return body as Record<string, unknown>;
}
@Controller('auth/me/saved-searches')
@UseGuards(JwtAuthGuard, FullAccessGuard)
export class SavedSearchesController {
  constructor(private readonly searches: SavedSearchesService) {}
  @Get() @Header('Cache-Control', 'no-store') list(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.searches.list(u.id, pageLimit(limit), cursor, a);
  }
  @Post() create(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Body() body: unknown,
  ) {
    const data = input(body, ['name', 'params']);
    return this.searches.create(u.id, data.name, data.params, a);
  }
  @Patch(':id') rename(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.searches.rename(u.id, id, input(body, ['name']).name, a);
  }
  @Delete(':id') remove(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
    @Param('id') id: string,
  ) {
    return this.searches.remove(u.id, id, a);
  }
}
