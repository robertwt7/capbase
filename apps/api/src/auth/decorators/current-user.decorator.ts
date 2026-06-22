import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@repo/api';

/** The authenticated principal attached to the request by JwtStrategy. */
export interface RequestUser {
  id: string;
  email: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
