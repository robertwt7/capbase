import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { MAX_PENDING_API_SUBMISSIONS, MAX_PENDING_SUBMISSIONS } from '@repo/api';

import { UsersService } from '../../users/users.service';
import type { RequestUser } from '../decorators/current-user.decorator';

/**
 * Caps how much one account can pile into the moderation queue. Runs after
 * JwtAuthGuard (or ApiKeyGuard), so `req.user` is set. Admins are exempt: they
 * moderate their own submissions anyway. Traffic with an API key gets the larger
 * MAX_PENDING_API_SUBMISSIONS: a script pushes a batch, a person types one form.
 */
@Injectable()
export class PendingCapGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;
    if (!user || user.role === 'ADMIN') return true;
    const cap = user.apiKey ? MAX_PENDING_API_SUBMISSIONS : MAX_PENDING_SUBMISSIONS;
    const pending = await this.users.countPending(user.id);
    if (pending >= cap) {
      throw new HttpException(
        `You have ${pending} submissions awaiting review. Please wait for some to be reviewed before adding more.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
