import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Controller, Get, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { UsersService } from '../users/users.service';
import { ApiThrottlerGuard } from './api-throttler.guard';
import { DEFAULT_TRUST_PROXY, parseTrustProxy, THROTTLE_MESSAGE } from './throttle';

@Controller('t')
class TestController {
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Get('read')
  read() {
    return { ok: true };
  }

  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Post('write')
  write() {
    return { ok: true };
  }

  @SkipThrottle()
  @Get('health')
  health() {
    return { ok: true };
  }
}

type Row = { role: 'USER' | 'ADMIN'; bannedAt: Date | null; tokenVersion: number };

/** A Nest app with only the throttler in front of three test routes. `trustProxy`
 *  decides whether supertest's loopback socket counts as the web container. */
async function makeApp(trustProxy: string, users: Record<string, Row> = {}) {
  const findById = jest.fn(async (id: string) => (users[id] ? { id, ...users[id] } : null));
  const moduleRef = await Test.createTestingModule({
    imports: [
      JwtModule.register({ secret: 'test-secret' }),
      ThrottlerModule.forRoot({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        errorMessage: THROTTLE_MESSAGE,
      }),
    ],
    controllers: [TestController],
    providers: [
      { provide: UsersService, useValue: { findById } },
      { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', trustProxy);
  await app.init();
  const jwt = moduleRef.get(JwtService);
  const token = (sub: string, role: 'USER' | 'ADMIN' = 'USER') =>
    `Bearer ${jwt.sign({ sub, email: `${sub}@x.dev`, role, tv: 0 })}`;
  return { app, http: () => request(app.getHttpServer()), token, findById };
}

/** Status codes of `n` identical requests, sent one after another. */
async function statuses(n: number, send: () => request.Test): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await send()).status);
  return out;
}

describe('ApiThrottlerGuard', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });
  const start = async (...args: Parameters<typeof makeApp>) => {
    const ctx = await makeApp(...args);
    close = () => ctx.app.close();
    return ctx;
  };

  describe('a caller that reaches the API directly (outside the trusted ranges)', () => {
    it('gets a 429 with a readable message and Retry-After past the route limit', async () => {
      const { http } = await start('10.0.0.0/8');
      expect(await statuses(2, () => http().get('/t/read'))).toEqual([200, 200]);
      const res = await http().get('/t/read');
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ message: THROTTLE_MESSAGE });
      expect(res.headers['retry-after']).toBeDefined();
    });

    it("can't dodge the limit by spoofing X-Forwarded-For", async () => {
      const { http } = await start('10.0.0.0/8');
      const codes = await statuses(3, () =>
        http().get('/t/read').set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 250)}`),
      );
      expect(codes).toEqual([200, 200, 429]);
    });

    it('never limits a @SkipThrottle route (health)', async () => {
      const { http } = await start('10.0.0.0/8');
      expect(await statuses(4, () => http().get('/t/health'))).toEqual([200, 200, 200, 200]);
    });
  });

  describe('requests from the web container (a trusted proxy)', () => {
    it('keys on the forwarded visitor IP, one bucket per visitor', async () => {
      const { http } = await start(DEFAULT_TRUST_PROXY);
      const as = (ip: string) => () => http().post('/t/write').set('x-forwarded-for', ip);
      expect(await statuses(3, as('203.0.113.1'))).toEqual([201, 201, 429]);
      expect(await statuses(1, as('203.0.113.2'))).toEqual([201]);
    });

    it("skips the web's cached reads, which carry no visitor IP", async () => {
      const { http } = await start(DEFAULT_TRUST_PROXY);
      expect(await statuses(4, () => http().get('/t/read'))).toEqual([200, 200, 200, 200]);
    });

    it('still limits a write that arrives without a visitor IP', async () => {
      const { http } = await start(DEFAULT_TRUST_PROXY);
      expect(await statuses(3, () => http().post('/t/write'))).toEqual([201, 201, 429]);
    });
  });

  describe('signed-in callers', () => {
    it('get a bucket per user, not per IP', async () => {
      const { http, token } = await start('10.0.0.0/8');
      const as = (sub: string) => () => http().get('/t/read').set('authorization', token(sub));
      expect(await statuses(3, as('alice'))).toEqual([200, 200, 429]);
      expect(await statuses(2, as('bob'))).toEqual([200, 200]);
    });

    it('fall back to the IP when the token is invalid', async () => {
      const { http } = await start('10.0.0.0/8');
      const codes = await statuses(3, () =>
        http().get('/t/read').set('authorization', 'Bearer not-a-jwt'),
      );
      expect(codes).toEqual([200, 200, 429]);
    });

    it('exempts an admin, checking the role against the row', async () => {
      const { http, token, findById } = await start('10.0.0.0/8', {
        root: { role: 'ADMIN', bannedAt: null, tokenVersion: 0 },
        demoted: { role: 'USER', bannedAt: null, tokenVersion: 0 },
      });
      const as = (sub: string) => () =>
        http().get('/t/read').set('authorization', token(sub, 'ADMIN'));
      expect(await statuses(4, as('root'))).toEqual([200, 200, 200, 200]);
      // The token still says ADMIN, the row no longer does.
      expect(await statuses(3, as('demoted'))).toEqual([200, 200, 429]);
      // A USER token never costs a lookup.
      findById.mockClear();
      await http().get('/t/read').set('authorization', token('carol'));
      expect(findById).not.toHaveBeenCalled();
    });
  });
});

describe('parseTrustProxy', () => {
  it('defaults to the private ranges and keeps a valid list', () => {
    expect(parseTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy(' loopback,172.16.0.0/12 ')).toBe('loopback, 172.16.0.0/12');
  });

  it('refuses anything that trusts every hop', () => {
    expect(parseTrustProxy('true')).toBeNull();
    expect(parseTrustProxy('1')).toBeNull();
  });
});
