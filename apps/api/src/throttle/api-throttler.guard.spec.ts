import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Controller, Get, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { API_KEY_DAILY_LIMITS, API_KEY_LIMITS, type ApiKeyScope } from '@repo/api';

import { ApiKeysService, type KeyedRequest } from '../api-keys/api-keys.service';
import { UsersService } from '../users/users.service';
import { ApiThrottlerGuard } from './api-throttler.guard';
import {
  DAILY_QUOTA_MESSAGE,
  DEFAULT_TRUST_PROXY,
  parseTrustProxy,
  THROTTLE_MESSAGE,
  V1_DAILY_THROTTLER,
  V1ReadThrottle,
  V1WriteThrottle,
} from './throttle';

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

  @V1ReadThrottle()
  @Get('v1')
  v1() {
    return { ok: true };
  }

  @V1ReadThrottle()
  @Get('v1b')
  v1b() {
    return { ok: true };
  }

  @V1WriteThrottle()
  @Post('v1w')
  v1w() {
    return { ok: true };
  }

  @SkipThrottle()
  @Get('health')
  health() {
    return { ok: true };
  }
}

type Row = { role: 'USER' | 'ADMIN'; bannedAt: Date | null; tokenVersion: number };

/** Test keys: `cbk_<name>` → its id, scope and owner. Anything else starting `cbk_` is dead. */
const KEYS: Record<string, { id: string; scope: ApiKeyScope; owner: string }> = {
  cbk_contrib1: { id: 'kc1', scope: 'contributor', owner: 'u1' },
  cbk_contrib1b: { id: 'kc1b', scope: 'contributor', owner: 'u1' },
  cbk_contrib2: { id: 'kc2', scope: 'contributor', owner: 'u2' },
  cbk_admin: { id: 'ka', scope: 'admin', owner: 'u3' },
};
const fakeApiKeys = {
  authenticateRequest: jest.fn(async (req: KeyedRequest) => {
    const token = String(req.headers.authorization).slice(7);
    const key = KEYS[token];
    if (!key) throw new Error('dead key');
    return { key: { id: key.id, scope: key.scope, prefix: token }, user: { id: key.owner } };
  }),
};

/** A Nest app with only the throttler in front of the test routes. `trustProxy`
 *  decides whether supertest's loopback socket counts as the web container; `dailyLimit`
 *  shrinks the daily quota (the real one is too many requests for a unit test). */
async function makeApp(trustProxy: string, users: Record<string, Row> = {}, dailyLimit?: number) {
  const findById = jest.fn(async (id: string) => (users[id] ? { id, ...users[id] } : null));
  const moduleRef = await Test.createTestingModule({
    imports: [
      JwtModule.register({ secret: 'test-secret' }),
      ThrottlerModule.forRoot({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 100 },
          dailyLimit === undefined
            ? V1_DAILY_THROTTLER
            : { ...V1_DAILY_THROTTLER, limit: dailyLimit },
        ],
        errorMessage: THROTTLE_MESSAGE,
      }),
    ],
    controllers: [TestController],
    providers: [
      { provide: UsersService, useValue: { findById } },
      { provide: ApiKeysService, useValue: fakeApiKeys },
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

describe('ApiThrottlerGuard with API keys', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });
  // The web's trust settings, so loopback counts as a trusted proxy: a key read must
  // still be counted even though it carries no X-Forwarded-For.
  const start = async () => {
    const ctx = await makeApp(DEFAULT_TRUST_PROXY);
    close = () => ctx.app.close();
    return ctx;
  };
  const read = (http: Awaited<ReturnType<typeof makeApp>>['http'], key: string) => () =>
    http().get('/t/v1').set('authorization', `Bearer ${key}`);

  it('shares one read bucket across every key of one owner', async () => {
    const { http } = await start();
    const limit = API_KEY_LIMITS.contributor.read;
    const codes = await statuses(limit, read(http, 'cbk_contrib1'));
    expect(codes.every((c) => c === 200)).toBe(true);
    // The owner's other key draws on the same budget.
    expect(await statuses(1, read(http, 'cbk_contrib1b'))).toEqual([429]);
    // Same IP, another owner: a fresh bucket.
    expect(await statuses(1, read(http, 'cbk_contrib2'))).toEqual([200]);
    // An admin key gets the larger budget, but a budget all the same.
    const admin = await statuses(limit + 1, read(http, 'cbk_admin'));
    expect(admin.every((c) => c === 200)).toBe(true);
  });

  it('shares one read bucket across every /v1 read route', async () => {
    const { http } = await start();
    const limit = API_KEY_LIMITS.contributor.read;
    const half = Math.floor(limit / 2);
    const first = await statuses(half, read(http, 'cbk_contrib1'));
    const second = await statuses(limit - half, () =>
      http().get('/t/v1b').set('authorization', 'Bearer cbk_contrib1'),
    );
    expect([...first, ...second].every((c) => c === 200)).toBe(true);
    expect(await statuses(1, read(http, 'cbk_contrib1'))).toEqual([429]);
    const res = await http().get('/t/v1b').set('authorization', 'Bearer cbk_contrib1');
    expect(res.status).toBe(429);
  });

  it('keeps writes in a bucket of their own', async () => {
    const { http } = await start();
    const write = () => http().post('/t/v1w').set('authorization', 'Bearer cbk_contrib1');
    const writes = API_KEY_LIMITS.contributor.write;
    expect((await statuses(writes, write)).every((c) => c === 201)).toBe(true);
    expect(await statuses(1, write)).toEqual([429]);
    // Reads are untouched by the exhausted write bucket.
    expect(await statuses(1, read(http, 'cbk_contrib1b'))).toEqual([200]);
  });

  it('sends the remaining budget, counted across routes', async () => {
    const { http } = await start();
    const limit = API_KEY_LIMITS.contributor.read;
    await http().get('/t/v1').set('authorization', 'Bearer cbk_contrib2');
    const res = await http().get('/t/v1b').set('authorization', 'Bearer cbk_contrib2');
    expect(res.headers['x-ratelimit-limit']).toBe(String(limit));
    expect(res.headers['x-ratelimit-remaining']).toBe(String(limit - 2));
  });

  it('caps an admin key at its own limit', async () => {
    const { http } = await start();
    const limit = API_KEY_LIMITS.admin.read;
    const codes = await statuses(limit + 1, read(http, 'cbk_admin'));
    expect(codes[limit - 1]).toBe(200);
    expect(codes[limit]).toBe(429);
  });

  it('counts a dead key on the IP', async () => {
    const { http } = await start();
    const limit = API_KEY_LIMITS.contributor.read;
    const codes = await statuses(limit + 1, read(http, 'cbk_dead1'));
    expect(codes[limit]).toBe(429);
    // Another dead key from the same address shares that IP bucket.
    expect(await statuses(1, read(http, 'cbk_dead2'))).toEqual([429]);
  });
});

describe('ApiThrottlerGuard daily quota', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });
  const start = async (dailyLimit: number, trustProxy = DEFAULT_TRUST_PROXY) => {
    const ctx = await makeApp(trustProxy, {}, dailyLimit);
    close = () => ctx.app.close();
    return ctx;
  };
  const as = (key: string) => `Bearer ${key}`;

  it('counts every key and route of one owner, then answers 429 with Retry-After', async () => {
    const { http } = await start(3);
    const ok = [
      (await http().get('/t/v1').set('authorization', as('cbk_contrib1'))).status,
      (await http().get('/t/v1b').set('authorization', as('cbk_contrib1b'))).status,
      (await http().post('/t/v1w').set('authorization', as('cbk_contrib1'))).status,
    ];
    expect(ok).toEqual([200, 200, 201]);
    const res = await http().get('/t/v1').set('authorization', as('cbk_contrib1b'));
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ message: DAILY_QUOTA_MESSAGE });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // Another owner has a quota of their own.
    const other = await http().get('/t/v1').set('authorization', as('cbk_contrib2'));
    expect(other.status).toBe(200);
  });

  it('sends the daily budget in -daily headers', async () => {
    const { http } = await start(50);
    await http().get('/t/v1').set('authorization', as('cbk_contrib2'));
    const res = await http().post('/t/v1w').set('authorization', as('cbk_contrib2'));
    expect(res.headers['x-ratelimit-limit-daily']).toBe('50');
    expect(res.headers['x-ratelimit-remaining-daily']).toBe('48');
  });

  it('never counts a request made without a live key', async () => {
    const { http, token } = await start(3, '10.0.0.0/8');
    // By IP, by JWT and by dead key: all past the daily limit, none blocked by it.
    const ip = await statuses(5, () => http().get('/t/v1'));
    const jwt = await statuses(5, () => http().get('/t/v1').set('authorization', token('alice')));
    const dead = await statuses(5, () =>
      http().get('/t/v1b').set('authorization', as('cbk_dead')),
    );
    expect([...ip, ...jwt, ...dead].every((c) => c === 200)).toBe(true);
    const res = await http().get('/t/v1').set('authorization', token('alice'));
    expect(res.headers['x-ratelimit-limit-daily']).toBeUndefined();
  });

  it('does not count a request the per-minute limit already refused', async () => {
    const writes = API_KEY_LIMITS.contributor.write;
    const { http } = await start(writes + 10);
    const write = () => http().post('/t/v1w').set('authorization', as('cbk_contrib1'));
    const codes = await statuses(writes + 3, write);
    expect(codes.slice(writes)).toEqual([429, 429, 429]);
    // `writes` counted, plus this read: the three per-minute 429s never reached the quota.
    const res = await http().get('/t/v1').set('authorization', as('cbk_contrib1'));
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-remaining-daily']).toBe('9');
  });

  it('sizes the quota by scope', async () => {
    // No override: the real limits, read off the key's scope.
    const { app, http } = await makeApp(DEFAULT_TRUST_PROXY);
    close = () => app.close();
    const contributor = await http().get('/t/v1').set('authorization', as('cbk_contrib1'));
    const admin = await http().get('/t/v1').set('authorization', as('cbk_admin'));
    expect(contributor.headers['x-ratelimit-limit-daily']).toBe(
      String(API_KEY_DAILY_LIMITS.contributor),
    );
    expect(admin.headers['x-ratelimit-limit-daily']).toBe(String(API_KEY_DAILY_LIMITS.admin));
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
