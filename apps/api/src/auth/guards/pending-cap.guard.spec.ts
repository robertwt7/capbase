import { describe, it, expect, jest } from '@jest/globals';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { MAX_PENDING_SUBMISSIONS } from '@repo/api';

import type { UsersService } from '../../users/users.service';
import type { RequestUser } from '../decorators/current-user.decorator';
import { PendingCapGuard } from './pending-cap.guard';

function contextFor(user?: RequestUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWith(pending: number) {
  const countPending = jest.fn(async () => pending);
  return { guard: new PendingCapGuard({ countPending } as unknown as UsersService), countPending };
}

const user: RequestUser = { id: 'u1', email: 'u@test.dev', role: 'USER', emailVerified: true };

describe('PendingCapGuard', () => {
  it('lets a user under the cap through', async () => {
    const { guard } = guardWith(MAX_PENDING_SUBMISSIONS - 1);
    await expect(guard.canActivate(contextFor(user))).resolves.toBe(true);
  });

  it('answers 429 once the user is at the cap', async () => {
    const { guard } = guardWith(MAX_PENDING_SUBMISSIONS);
    const err = await guard.canActivate(contextFor(user)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('exempts admins without counting', async () => {
    const { guard, countPending } = guardWith(1000);
    await expect(guard.canActivate(contextFor({ ...user, role: 'ADMIN' }))).resolves.toBe(true);
    expect(countPending).not.toHaveBeenCalled();
  });
});
