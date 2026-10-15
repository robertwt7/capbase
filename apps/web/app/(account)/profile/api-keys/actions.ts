'use server';

import { revalidatePath } from 'next/cache';
import { MAX_ACTIVE_API_KEYS } from '@repo/api';

import { ApiError } from '@/lib/api';
import { createApiKey, revokeApiKey } from '@/lib/api-keys';
import { apiKeyFormSchema, toCreateApiKeyInput } from '@/lib/validation/api-key';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

/** The API's 400 lists one message per problem, each starting with the field it is about. */
function fieldErrorsFromApi(body: unknown): Record<string, string> {
  const messages = (body as { message?: unknown } | undefined)?.message;
  const out: Record<string, string> = {};
  for (const message of Array.isArray(messages) ? messages : [messages]) {
    if (typeof message !== 'string') continue;
    const field = ['name', 'scope', 'allowedCidrs'].find((f) => message.startsWith(f));
    if (field && !(field in out)) {
      out[field] = message.replace(/^allowedCidrs:\s*/, '');
    }
  }
  return out;
}

/** Mint a key. On success the token rides back once, for the one-time reveal panel. */
export async function createApiKeyAction(
  values: unknown,
): Promise<ActionResult & { token?: string }> {
  const parsed = apiKeyFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  let token: string;
  try {
    token = (await createApiKey(toCreateApiKeyInput(parsed.data))).token;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      const fieldErrors = fieldErrorsFromApi(error.body);
      if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
    }
    if (error instanceof ApiError && error.status === 409) {
      return {
        ok: false,
        formError: `You already have ${MAX_ACTIVE_API_KEYS} active keys. Revoke one to create another.`,
      };
    }
    if (error instanceof ApiError && (error.status === 403 || error.status === 429)) {
      const message = (error.body as { message?: unknown } | undefined)?.message;
      return {
        ok: false,
        formError: typeof message === 'string' ? message : 'You can’t create a key right now.',
      };
    }
    return { ok: false, formError: 'Could not create the key. Please try again.' };
  }

  revalidatePath('/profile/api-keys');
  return { ok: true, token };
}

export async function revokeApiKeyAction(id: string): Promise<void> {
  await revokeApiKey(id);
  revalidatePath('/profile/api-keys');
}
