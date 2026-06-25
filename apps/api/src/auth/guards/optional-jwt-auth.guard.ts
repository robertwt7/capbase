import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but never rejects anonymous requests: a valid token attaches
 * the user, a missing/invalid one leaves `req.user` undefined. Used for reads that
 * are public but behave differently when the viewer is known (e.g. gated detail).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<T = unknown>(_err: unknown, user: T): T {
    return (user || undefined) as T;
  }
}
