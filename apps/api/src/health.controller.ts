import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from './prisma/prisma.service';

/**
 * Liveness that proves the database answers — the compose healthcheck and the
 * external uptime monitor both hit this, not `GET /`, which never touches Postgres.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ ok: true }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('database unreachable');
    }
    return { ok: true };
  }
}
