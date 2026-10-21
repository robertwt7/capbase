import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  API_KEY_PREFIX,
  API_KEY_SCOPES,
  EMAIL_UNVERIFIED,
  MAX_ACTIVE_API_KEYS,
  MFA_REQUIRED,
  scopesForRole,
  type ApiKeyScope,
  type ApiKeySummary,
  type CreateApiKeyInput,
  type CreatedApiKey,
  type Role,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import type { RequestUser } from '../auth/decorators/current-user.decorator';
import { MfaPolicy } from '../auth/mfa/policy';
import { PrismaService } from '../prisma/prisma.service';

/** The principal a valid key resolves to: its owner, plus the key's own ceiling. */
export interface AuthenticatedKey {
  user: RequestUser;
  key: { id: string; scope: ApiKeyScope; prefix: string };
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PUBLIC_ID_LENGTH = 8;
/** `cbk_<8 base62>_<43 base64url>`: the first part is the lookup handle, the rest 32 random bytes. */
const TOKEN_PATTERN = new RegExp(
  `^(${API_KEY_PREFIX}[A-Za-z0-9]{${PUBLIC_ID_LENGTH}})_[A-Za-z0-9_-]{43}$`,
);
/** lastUsedAt is bookkeeping, not an audit log: one write per key per minute at most. */
const LAST_USED_DEBOUNCE_MS = 60_000;

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

/** Memoises the key lookup on the request, so the throttler and ApiKeyGuard share one query. */
const KEY_AUTH = Symbol('apiKeyAuth');

/** The Express request fields the key lookup reads. */
export interface KeyedRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  [KEY_AUTH]?: Promise<AuthenticatedKey>;
}

/** The bearer token on a request when it is an API key (`cbk_…`), else null. */
export function bearerApiKey(req: Pick<KeyedRequest, 'headers'>): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.startsWith(API_KEY_PREFIX) ? token : null;
}

/** `::ffff:1.2.3.4` → `1.2.3.4`, so an IPv4 allowlist matches a dual-stack socket. */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1]! : ip;
}

/**
 * Parse an allowlist entry into canonical `address/prefix`. A bare address is a single host
 * (/32 or /128). Null when it isn't a valid CIDR.
 */
export function parseCidr(raw: string): { address: string; prefix: number; family: 4 | 6 } | null {
  const [address = '', bits, ...rest] = raw.trim().split('/');
  if (rest.length > 0) return null;
  const host = normalizeIp(address);
  const family = isIP(host);
  if (family !== 4 && family !== 6) return null;
  const max = family === 4 ? 32 : 128;
  if (bits !== undefined && !/^\d{1,3}$/.test(bits)) return null;
  const prefix = bits === undefined ? max : Number(bits);
  if (prefix > max) return null;
  return { address: host, prefix, family };
}

/** True when `ip` falls in any of `cidrs`; an empty list allows every address. */
export function ipAllowed(ip: string, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) return true;
  const host = normalizeIp(ip);
  const family = isIP(host);
  if (family !== 4 && family !== 6) return false;
  const list = new BlockList();
  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    if (parsed) list.addSubnet(parsed.address, parsed.prefix, `ipv${parsed.family}`);
  }
  return list.check(host, `ipv${family}`);
}

const keySelect = {
  id: true,
  name: true,
  prefix: true,
  scope: true,
  allowedCidrs: true,
  createdAt: true,
  lastUsedAt: true,
} as const;

type KeyRow = Prisma.ApiKeyGetPayload<{ select: typeof keySelect }>;

/**
 * Personal API keys for /v1. A key is not a separate principal: it resolves to its owner (so
 * attribution, the pending cap and revisions all work unchanged), with the key's scope as a
 * ceiling the owner's CURRENT role must still permit. Only the sha256 of a token is stored; the
 * token itself is returned once, by `create`.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MfaPolicy,
  ) {}

  /** A fresh token, its lookup prefix and the hash that is all the database keeps. */
  mint(): { prefix: string; token: string; hash: string } {
    const id = Array.from(randomBytes(PUBLIC_ID_LENGTH), (b) => BASE62[b % BASE62.length]).join('');
    const prefix = `${API_KEY_PREFIX}${id}`;
    const token = `${prefix}_${randomBytes(32).toString('base64url')}`;
    return { prefix, token, hash: sha256(token) };
  }

  async create(
    owner: Pick<RequestUser, 'id' | 'role' | 'emailVerified'>,
    input: CreateApiKeyInput,
  ): Promise<CreatedApiKey> {
    if (owner.role === 'USER') {
      throw new ForbiddenException('API access is granted by Capbase admins');
    }
    if (!scopesForRole(owner.role).includes(input.scope)) {
      throw new ForbiddenException('Only admins can create admin keys');
    }
    if (owner.role !== 'ADMIN' && !owner.emailVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: EMAIL_UNVERIFIED,
        message: 'Confirm your email address before creating an API key.',
      });
    }
    const allowedCidrs = (input.allowedCidrs ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .map((c) => {
        const parsed = parseCidr(c);
        if (!parsed) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            message: [`allowedCidrs: "${c}" is not a valid IP address or CIDR range`],
          });
        }
        return `${parsed.address}/${parsed.prefix}`;
      });

    const active = await this.prisma.apiKey.count({
      where: { userId: owner.id, revokedAt: null },
    });
    if (active >= MAX_ACTIVE_API_KEYS) {
      throw new ConflictException(
        `You already have ${MAX_ACTIVE_API_KEYS} active keys. Revoke one before creating another.`,
      );
    }

    const { prefix, token, hash } = this.mint();
    const row = await this.prisma.apiKey.create({
      data: {
        userId: owner.id,
        name: input.name.trim(),
        scope: input.scope,
        prefix,
        hash,
        allowedCidrs: [...new Set(allowedCidrs)],
      },
      select: keySelect,
    });
    return { key: this.toSummary(row), token };
  }

  /** The owner's active keys, newest first. */
  async list(userId: string): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: keySelect,
    });
    return rows.map((r) => this.toSummary(r));
  }

  /** Revoke one of the owner's keys. 404 for someone else's, an unknown or an already-revoked key. */
  async revoke(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('API key not found');
  }

  /**
   * Revoke the keys a user's new standing no longer permits: every key for a ban or a demotion to
   * USER, the admin keys for a demotion to CONTRIBUTOR. Runs inside the role/ban transaction.
   * (`authenticate` re-checks the role on every request anyway; this makes the keys disappear
   * from the owner's list instead of lingering dead.)
   */
  async revokeForRole(
    tx: Prisma.TransactionClient,
    userId: string,
    role: Role,
    banned: boolean,
  ): Promise<void> {
    const keep = banned ? [] : scopesForRole(role);
    if (keep.length === API_KEY_SCOPES.length) return;
    await tx.apiKey.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(keep.length ? { scope: { notIn: [...keep] } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Resolve a request's `Bearer cbk_…` key, once per request: the throttler and ApiKeyGuard both
   * call this and share the one lookup. Rejects like `authenticate`.
   */
  authenticateRequest(req: KeyedRequest): Promise<AuthenticatedKey> {
    req[KEY_AUTH] ??= this.authenticate(
      bearerApiKey(req) ?? '',
      req.ip ?? req.socket?.remoteAddress ?? '',
    );
    return req[KEY_AUTH];
  }

  /**
   * 401 for a dead key (malformed, unknown, wrong secret, revoked, banned owner, or an owner whose
   * role no longer permits the key's scope); 403 for an owner whose role requires 2FA and who has
   * none (`MFA_REQUIRED`), an unverified non-admin owner (`EMAIL_UNVERIFIED`, the body
   * VerifiedEmailGuard sends) or an address outside the allowlist.
   */
  async authenticate(token: string, ip: string): Promise<AuthenticatedKey> {
    const prefix = TOKEN_PATTERN.exec(token)?.[1];
    if (!prefix) throw new UnauthorizedException('Invalid API key');
    const row = await this.prisma.apiKey.findUnique({
      where: { prefix },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            bannedAt: true,
            emailVerifiedAt: true,
            mfaEnabledAt: true,
          },
        },
      },
    });
    const expected = Buffer.from(row?.hash ?? '', 'hex');
    const actual = Buffer.from(sha256(token), 'hex');
    if (
      !row ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual) ||
      row.revokedAt ||
      row.user.bannedAt ||
      !scopesForRole(row.user.role).includes(row.scope as ApiKeyScope)
    ) {
      throw new UnauthorizedException('Invalid API key');
    }
    const { user } = row;
    // Not revoked: the key works again as soon as its owner enrolls a factor.
    if (this.policy.unmet(user)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: MFA_REQUIRED,
        message: "The key's owner must turn on two-factor authentication. See /developers.",
      });
    }
    if (user.role !== 'ADMIN' && !user.emailVerifiedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: EMAIL_UNVERIFIED,
        message: 'Confirm your email address before using an API key.',
      });
    }
    if (!ipAllowed(ip, row.allowedCidrs)) {
      throw new ForbiddenException(`This key may not be used from ${normalizeIp(ip)}`);
    }

    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_DEBOUNCE_MS) {
      // Conditional, so two concurrent requests write once.
      await this.prisma.apiKey.updateMany({
        where: {
          id: row.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now - LAST_USED_DEBOUNCE_MS) } }],
        },
        data: { lastUsedAt: new Date(now) },
      });
    }

    const scope = row.scope as ApiKeyScope;
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
        apiKey: { id: row.id, scope, prefix: row.prefix },
      },
      key: { id: row.id, scope, prefix: row.prefix },
    };
  }

  private toSummary(row: KeyRow): ApiKeySummary {
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scope: row.scope as ApiKeyScope,
      allowedCidrs: row.allowedCidrs,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    };
  }
}
