import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@repo/api';

/** The authenticated principal attached to the request by JwtStrategy. */
export interface RequestUser {
  id: string;
  email: string;
  role: Role;
  /** Read from the row on every request, like role, so verifying takes effect at once. */
  emailVerified: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
