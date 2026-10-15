import { applyDecorators, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AdminKeyGuard, ApiKeyGuard } from '../guards/api-key.guard';
import { PendingCapGuard } from '../guards/pending-cap.guard';

/** The errors every /v1 route can answer, documented once. */
const keyErrors = () =>
  applyDecorators(
    ApiBearerAuth('apiKey'),
    ApiUnauthorizedResponse({
      description:
        'No key, a malformed or unknown key, a revoked key, or an owner who is banned or ' +
        "whose role no longer permits the key's scope.",
    }),
    ApiForbiddenResponse({
      description:
        "The request comes from outside the key's IP allowlist, the owner has not verified " +
        'their email (`code: EMAIL_UNVERIFIED`), or the route needs an admin key.',
    }),
    ApiTooManyRequestsResponse({
      description: 'Over the per-key rate limit (see `Retry-After`) or the pending-submission cap.',
    }),
  );

/** Every /v1 route: a valid API key. */
export const ApiKeyAuth = () => applyDecorators(UseGuards(ApiKeyGuard), keyErrors());

/** A /v1 write: under the key pending cap (MAX_PENDING_API_SUBMISSIONS). No Turnstile — the
 *  caller is a script, and the key is the proof of who it is. Use after `ApiKeyAuth()`. */
export const KeyContribution = () => applyDecorators(UseGuards(PendingCapGuard));

/** A /v1 route for admin keys only (the moderation queue). Includes ApiKeyGuard, in order:
 *  stacking two class-level UseGuards would run them bottom-up. */
export const AdminKey = () => applyDecorators(UseGuards(ApiKeyGuard, AdminKeyGuard), keyErrors());
