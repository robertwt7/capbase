import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { MAX_PENDING_SUBMISSIONS } from '@repo/api';

import { UsersService } from '../../users/users.service';
import type { RequestUser } from '../decorators/current-user.decorator';

/**
 * Caps how much one account can pile into the moderation queue. Runs after
 * JwtAuthGuard, so `req.user` is set. Admins are exempt: they moderate their
 * own submissions anyway.
 */
@Injectable()
export class PendingCapGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user || user.role === 'ADMIN') return true;
    const pending = await this.users.countPending(user.id);
    if (pending >= MAX_PENDING_SUBMISSIONS) {
      throw new HttpException(
        `You have ${pending} submissions awaiting review. Please wait for some to be reviewed before adding more.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
