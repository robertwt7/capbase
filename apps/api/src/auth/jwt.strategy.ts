import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Role } from '@repo/api';

import { UsersService } from '../users/users.service';
import type { RequestUser } from './decorators/current-user.decorator';
import { MfaPolicy } from './mfa/policy';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  /** User.tokenVersion at signing. Absent on tokens minted before it existed. */
  tv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly policy: MfaPolicy,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Re-reads the user on every request, so the token is only proof of identity:
   * role comes from the row (a demoted admin loses access immediately), and a
   * ban or a password change/reset (tokenVersion bump) kills live sessions.
   * A token without `tv` counts as version 0, so deploying this doesn't sign
   * everyone out. A role in MFA_REQUIRED_ROLES without a second factor has no
   * session either — that catches a promotion, and the next password sign-in
   * lands on forced setup. Read off the same row: no extra query.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.users.findById(payload.sub);
    if (
      !user ||
      user.bannedAt ||
      (payload.tv ?? 0) !== user.tokenVersion ||
      this.policy.unmet(user)
    ) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }
}
