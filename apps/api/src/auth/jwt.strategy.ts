import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Role } from '@repo/api';

import { UsersService } from '../users/users.service';
import type { RequestUser } from './decorators/current-user.decorator';

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
   * everyone out.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.bannedAt || (payload.tv ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException();
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
