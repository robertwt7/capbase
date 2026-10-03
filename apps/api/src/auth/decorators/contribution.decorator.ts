import { applyDecorators, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PendingCapGuard } from '../guards/pending-cap.guard';
import { TurnstileGuard } from '../guards/turnstile.guard';

/**
 * The guard stack every contribution endpoint shares: signed in, under the
 * pending cap, and (when configured) a passed Turnstile challenge. The cap runs
 * before Turnstile so a capped user doesn't spend a token for nothing.
 */
export const Contribution = () =>
  applyDecorators(UseGuards(JwtAuthGuard, PendingCapGuard, TurnstileGuard));
