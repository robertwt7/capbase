import {
  API_KEY_NAME_MAX,
  API_KEY_SCOPES,
  MAX_API_KEY_CIDRS,
  type CreateApiKeyInput,
} from '@repo/api';
import { z } from 'zod';

/** One allowlist entry: an IPv4/IPv6 address, optionally with a /prefix. A shape check only —
    the API parses each one and is authoritative. */
const CIDR_SHAPE = /^[0-9a-f:.]+(\/\d{1,3})?$/i;

/** The allowlist textarea, one entry per line (commas also split). */
export function parseCidrList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

export const apiKeyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the key, e.g. “Data team laptop”.')
    .max(API_KEY_NAME_MAX, `Use at most ${API_KEY_NAME_MAX} characters.`),
  scope: z.enum(API_KEY_SCOPES as readonly [string, ...string[]]),
  allowedCidrs: z.string().superRefine((raw, ctx) => {
    const entries = parseCidrList(raw);
    if (entries.length > MAX_API_KEY_CIDRS) {
      ctx.addIssue({ code: 'custom', message: `Use at most ${MAX_API_KEY_CIDRS} entries.` });
      return;
    }
    const bad = entries.find((c) => !CIDR_SHAPE.test(c));
    if (bad) ctx.addIssue({ code: 'custom', message: `“${bad}” is not an IP address or range.` });
  }),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;

export const apiKeyFormDefaults: ApiKeyFormValues = {
  name: '',
  scope: 'contributor',
  allowedCidrs: '',
};

export function toCreateApiKeyInput(v: ApiKeyFormValues): CreateApiKeyInput {
  return {
    name: v.name,
    scope: v.scope as CreateApiKeyInput['scope'],
    allowedCidrs: parseCidrList(v.allowedCidrs),
  };
}
