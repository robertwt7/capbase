import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { z } from 'zod';

/** Collapse a ZodError into a flat { field: firstMessage } map, keyed by the
    dotted field path. Used by server actions to report validation failures in
    the same shape the client form already understands. */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : 'form';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Push server-reported field errors back into a react-hook-form instance. */
export function applyServerErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  errors: Record<string, string>,
) {
  for (const [name, message] of Object.entries(errors)) {
    setError(name as Path<T>, { type: 'server', message });
  }
}

/** Discriminated result every contribution server action returns. */
export type ActionResult =
  | { ok: true }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };
