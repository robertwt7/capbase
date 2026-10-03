import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TURNSTILE_HEADER } from '@repo/api';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Cloudflare Turnstile check for writes a bot would want to automate
 * (registration, contributions). The web forwards the widget's token in the
 * `x-turnstile-token` header; this guard spends it against `siteverify`.
 *
 * Off when `TURNSTILE_SECRET` is unset, so local dev, CI and e2e need no
 * Cloudflare account. Fails closed when it is set: a Cloudflare outage blocks
 * contributions rather than letting every bot through.
 */
@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly logger = new Logger(TurnstileGuard.name);

  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = this.config.get<string>('TURNSTILE_SECRET');
    if (!secret) return true;

    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const token = req.headers[TURNSTILE_HEADER];
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      throw new ForbiddenException('Human verification is required');
    }

    let result: SiteverifyResponse;
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body: new URLSearchParams({ secret, response: token }),
        signal: AbortSignal.timeout(5000),
      });
      result = (await res.json()) as SiteverifyResponse;
    } catch (err) {
      this.logger.error(`Turnstile siteverify failed: ${(err as Error).message}`);
      throw new ForbiddenException('Human verification is unavailable, please retry');
    }
    if (!result.success) {
      this.logger.warn(`Turnstile rejected token: ${(result['error-codes'] ?? []).join(',')}`);
      throw new ForbiddenException('Human verification failed, please retry');
    }
    return true;
  }
}
