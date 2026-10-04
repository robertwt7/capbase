import { describe, it, expect } from '@jest/globals';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { EMAIL_UNVERIFIED } from '@repo/api';

import type { RequestUser } from '../decorators/current-user.decorator';
import { VerifiedEmailGuard } from './verified-email.guard';

function contextFor(user?: RequestUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const user: RequestUser = { id: 'u1', email: 'u@test.dev', role: 'USER', emailVerified: true };
const guard = new VerifiedEmailGuard();

describe('VerifiedEmailGuard', () => {
  it('lets a verified user through', () => {
    expect(guard.canActivate(contextFor(user))).toBe(true);
  });

  it('answers 403 with EMAIL_UNVERIFIED for an unverified user', () => {
    let err: unknown;
    try {
      guard.canActivate(contextFor({ ...user, emailVerified: false }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getStatus()).toBe(403);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: EMAIL_UNVERIFIED });
  });

  it('exempts an unverified admin', () => {
    expect(guard.canActivate(contextFor({ ...user, role: 'ADMIN', emailVerified: false }))).toBe(
      true,
    );
  });

  it('leaves a missing user to JwtAuthGuard', () => {
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });
});
