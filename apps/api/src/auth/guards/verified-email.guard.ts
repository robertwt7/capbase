import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { EMAIL_UNVERIFIED } from '@repo/api';

import type { RequestUser } from '../decorators/current-user.decorator';

/**
 * Contributions need a verified email, which makes throwaway accounts cost a
 * real inbox each. Runs after JwtAuthGuard and reads the flag JwtStrategy put
 * on the principal, so it costs no query. Admins are exempt. The 403 carries a
 * `code` so the web can tell it apart from any other refusal.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user || user.role === 'ADMIN' || user.emailVerified) return true;
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: EMAIL_UNVERIFIED,
      message: 'Confirm your email address before contributing.',
    });
  }
}
