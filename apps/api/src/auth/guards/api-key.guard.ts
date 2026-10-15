import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { ApiKeysService, bearerApiKey, type KeyedRequest } from '../../api-keys/api-keys.service';
import type { RequestUser } from '../decorators/current-user.decorator';

/**
 * /v1 auth: a `Bearer cbk_…` API key only. A JWT is refused here, and a key is refused
 * everywhere else (JwtStrategy never verifies one). Sets `req.user` like JwtStrategy does, with
 * `apiKey` filled in. The lookup is shared with the throttler, which ran first.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<KeyedRequest & { user?: RequestUser }>();
    if (!bearerApiKey(req)) {
      throw new UnauthorizedException(
        'An API key is required: send `Authorization: Bearer cbk_…`. See /developers.',
      );
    }
    req.user = (await this.apiKeys.authenticateRequest(req)).user;
    return true;
  }
}

/** Requires an admin-scoped key. Runs after ApiKeyGuard. */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (user?.apiKey?.scope !== 'admin') {
      throw new ForbiddenException('This endpoint needs an admin key');
    }
    return true;
  }
}
