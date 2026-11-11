import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FULL_ACCESS_REQUIRED, type ViewerAccess } from '@repo/api';
import { UsersService } from '../users/users.service';
import { MfaPolicy } from '../auth/mfa/policy';
/** The current account row and its access, as `require` resolved them. */
export interface FullAccess {
  user: NonNullable<Awaited<ReturnType<UsersService['findById']>>>;
  access: ViewerAccess;
}
@Injectable()
export class FullAccessService {
  constructor(
    private readonly users: UsersService,
    private readonly mfa: MfaPolicy,
  ) {}
  /** `known`: what FullAccessGuard already resolved for this request (see CurrentAccess),
   *  so a guarded route checks once, not once in the guard and again in the service. */
  async require(userId?: string, now = new Date(), known?: FullAccess): Promise<FullAccess> {
    if (!userId) throw new UnauthorizedException();
    if (known && known.user.id === userId) return known;
    const user = await this.users.findById(userId);
    if (!user || user.bannedAt || this.mfa.unmet(user))
      throw new UnauthorizedException();
    const access = await this.users.accessFor(user, now);
    if (!access.unlocked)
      throw new ForbiddenException({
        code: FULL_ACCESS_REQUIRED,
        message: 'Current full access is required',
      });
    return { user, access };
  }
}
type GuardedRequest = { user?: { id: string }; fullAccess?: FullAccess };
@Injectable()
export class FullAccessGuard implements CanActivate {
  constructor(private readonly fullAccess: FullAccessService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<GuardedRequest>();
    req.fullAccess = await this.fullAccess.require(req.user?.id);
    return true;
  }
}
/** The account and access FullAccessGuard resolved; pass it to the service as `known`. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FullAccess | undefined =>
    ctx.switchToHttp().getRequest<GuardedRequest>().fullAccess,
)
