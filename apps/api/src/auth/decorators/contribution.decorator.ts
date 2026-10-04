import { applyDecorators, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PendingCapGuard } from '../guards/pending-cap.guard';
import { TurnstileGuard } from '../guards/turnstile.guard';
import { VerifiedEmailGuard } from '../guards/verified-email.guard';

/**
 * The guard stack every contribution endpoint shares: signed in, a verified
 * email, under the pending cap, and (when configured) a passed Turnstile
 * challenge. Cheapest first: the verified check costs no query, the cap one
 * count, and Turnstile runs last so a refused user doesn't spend a token.
 */
export const Contribution = () =>
  applyDecorators(UseGuards(JwtAuthGuard, VerifiedEmailGuard, PendingCapGuard, TurnstileGuard));
