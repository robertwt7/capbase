import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

import type { JwtPayload } from '../auth/jwt.strategy';
import { UsersService } from '../users/users.service';

const IDENTITY = Symbol('throttleIdentity');

interface Identity {
  userId: string;
  admin: boolean;
}

/** Throttle-relevant view of an Express request. */
interface ThrottledRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  app?: { get(setting: string): unknown };
  [IDENTITY]?: Identity | null;
}

/**
 * The global rate limiter (limits in ./throttle.ts). It keys each request on:
 *
 * - **the user**, when it carries a valid JWT: so people behind one NAT don't share
 *   a bucket, and one account can't spread its requests across many IPs;
 * - **the client IP** otherwise: `req.ip`, which under `trust proxy` (main.ts) is the
 *   visitor's address the web forwarded in X-Forwarded-For, or the socket address of
 *   a caller that came straight at the API.
 *
 * It skips admins (the role re-read from the row, like JwtStrategy does, so a demoted
 * admin loses the exemption at once) and the web's own **reads that carry no visitor
 * IP**: those are the ISR-cached public fetches. Forwarding an IP on them would split
 * Next's fetch cache per visitor, and keying them on the web container would put every
 * visitor in one bucket. nginx has already limited the visitor behind them. Writes
 * always carry the IP (apps/web/lib/api.ts), so they are always limited.
 *
 * The decoded token is only an identity here; the route's own guards still decide
 * access. An invalid or expired token falls back to the IP.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {
    super(options, storage, reflector);
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ThrottledRequest>();
    if (isUnattributedInternalRead(req)) return true;
    return (await this.identify(req))?.admin === true;
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const identity = await this.identify(req as unknown as ThrottledRequest);
    if (identity) return `user:${identity.userId}`;
    return `ip:${await super.getTracker(req)}`;
  }

  /** The signed-in user behind the request, decoded once and memoised on it. */
  private async identify(req: ThrottledRequest): Promise<Identity | null> {
    if (req[IDENTITY] !== undefined) return req[IDENTITY];
    let identity: Identity | null = null;
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        identity = {
          userId: payload.sub,
          // Only a token that claims ADMIN costs a query.
          admin: payload.role === 'ADMIN' && (await this.isAdmin(payload)),
        };
      } catch {
        identity = null;
      }
    }
    req[IDENTITY] = identity;
    return identity;
  }

  private async isAdmin(payload: JwtPayload): Promise<boolean> {
    const user = await this.users.findById(payload.sub);
    return (
      !!user &&
      user.role === 'ADMIN' &&
      !user.bannedAt &&
      (payload.tv ?? 0) === user.tokenVersion
    );
  }
}

/**
 * A GET from a trusted proxy (the web container) that names no visitor: one of the
 * web's cached public reads. Uses the app's own compiled `trust proxy` check, so a
 * caller from outside the trusted ranges is never skipped, header or not.
 */
export function isUnattributedInternalRead(req: ThrottledRequest): boolean {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (req.headers['x-forwarded-for']) return false;
  const trusts = req.app?.get('trust proxy fn');
  const address = req.socket?.remoteAddress;
  return typeof trusts === 'function' && !!address && trusts(address, 0) === true;
}
