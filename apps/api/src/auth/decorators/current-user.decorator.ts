import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ApiKeyScope, Role } from '@repo/api';

/** The authenticated principal attached to the request by JwtStrategy, or by ApiKeyGuard on /v1. */
export interface RequestUser {
  id: string;
  email: string;
  role: Role;
  /** Read from the row on every request, like role, so verifying takes effect at once. */
  emailVerified: boolean;
  /** Set when the request was authenticated with an API key (/v1); absent on JWT requests.
   *  The scope is a ceiling on top of `role`: an admin's contributor key acts as a contributor. */
  apiKey?: { id: string; scope: ApiKeyScope; prefix: string };
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
