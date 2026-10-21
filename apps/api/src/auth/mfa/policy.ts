import { Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROLES, type Role } from '@repo/api';

/** Production's default: the two roles whose sessions and /v1 keys can publish or write data. */
export const DEFAULT_MFA_REQUIRED_ROLES: readonly Role[] = ['ADMIN', 'CONTRIBUTOR'];

/** Parse a `MFA_REQUIRED_ROLES` comma list. Null when it names something that isn't a role. */
export function parseMfaRoles(raw: string): Role[] | null {
  const roles = raw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return roles.every((r) => (ROLES as readonly string[]).includes(r)) ? (roles as Role[]) : null;
}

/**
 * Which roles must have a second factor. Unset → ADMIN + CONTRIBUTOR in production and none
 * elsewhere (so local dev and the e2e suites, which sign in as admin with a password, keep
 * working). Set — even to empty — → exactly that list.
 */
export function mfaRequiredRoles(env: { MFA_REQUIRED_ROLES?: string; NODE_ENV?: string }): Role[] {
  if (env.MFA_REQUIRED_ROLES === undefined) {
    return env.NODE_ENV === 'production' ? [...DEFAULT_MFA_REQUIRED_ROLES] : [];
  }
  // validateEnv has already rejected an unknown role.
  return parseMfaRoles(env.MFA_REQUIRED_ROLES) ?? [];
}

/** Reads MFA_REQUIRED_ROLES once. The one place that decides whether a role needs 2FA. */
@Injectable()
export class MfaPolicy {
  private readonly roles: ReadonlySet<Role>;

  constructor(config: ConfigService) {
    this.roles = new Set(
      mfaRequiredRoles({
        MFA_REQUIRED_ROLES: config.get<string>('MFA_REQUIRED_ROLES'),
        NODE_ENV: config.get<string>('NODE_ENV'),
      }),
    );
  }

  requires(role: Role): boolean {
    return this.roles.has(role);
  }

  /** A required role with no factor: no session, no /v1 key, until one is enrolled. */
  unmet(user: { role: Role; mfaEnabledAt: Date | null }): boolean {
    return this.requires(user.role) && !user.mfaEnabledAt;
  }
}

/** Its own module (ConfigModule is global) so ApiKeysModule can use it without importing
 *  AuthModule, which already imports ApiKeysModule. */
@Module({ providers: [MfaPolicy], exports: [MfaPolicy] })
export class MfaPolicyModule {}
