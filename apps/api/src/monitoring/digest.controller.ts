import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentAccess, FullAccessGuard, type FullAccess } from '../saved-searches/full-access.guard';
import { UnsubscribeThrottle } from '../throttle/throttle';
import { PrismaService } from '../prisma/prisma.service';
import { DigestService } from './digest.service';
import { validDigestUnsubscribe } from './digest-unsubscribe';
@Controller('auth/me/digest')
@UseGuards(JwtAuthGuard)
export class DigestController {
  constructor(private readonly digest: DigestService) {}
  @Put() @UseGuards(FullAccessGuard) optIn(
    @CurrentUser() u: RequestUser,
    @CurrentAccess() a: FullAccess | undefined,
  ) {
    return this.digest.optIn(u.id, undefined, a);
  }
  @Delete() optOut(@CurrentUser() u: RequestUser) {
    return this.digest.optOut(u.id);
  }
}
@Controller('monitoring/unsubscribe')
export class DigestUnsubscribeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  @Post()
  @HttpCode(200)
  @UnsubscribeThrottle()
  async unsubscribe(@Body() input: unknown) {
    if (
      input &&
      typeof input === 'object' &&
      'u' in input &&
      't' in input &&
      validDigestUnsubscribe(
        this.config.getOrThrow<string>('JWT_SECRET'),
        input.u,
        input.t,
      )
    )
      await this.prisma.user.updateMany({
        where: { id: input.u },
        data: { digestOptInAt: null },
      });
    return { ok: true };
  }
}
