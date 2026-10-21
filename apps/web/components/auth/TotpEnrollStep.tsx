'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { TotpSetup } from '@repo/api';

import { QrCode } from '@/components/QrCode';
import { Button, Form, FormError, TextField } from '@/components/ui';
import {
  totpCodeDefaults,
  totpCodeSchema,
  type TotpCodeValues,
} from '@/lib/validation/mfa';
import { applyServerErrors, type ActionResult } from '@/lib/validation/utils';

/** "ABCD EFGH …": the base32 secret in fours, for typing into an app by hand. */
const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/** The QR + secret + code step of an authenticator-app enrollment, in account settings and in
 *  forced setup at sign-in. `onConfirm` sends the code and reports back like a server action. */
export function TotpEnrollStep({
  setup,
  onConfirm,
  onCancel,
}: {
  setup: Pick<TotpSetup, 'secret' | 'otpauthUri'>;
  onConfirm: (values: TotpCodeValues) => Promise<ActionResult>;
  onCancel?: () => void;
}) {
  const form = useForm<TotpCodeValues>({
    resolver: zodResolver(totpCodeSchema),
    defaultValues: totpCodeDefaults,
  });
  const [formError, setFormError] = useState<string>();

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await onConfirm(values);
    if (result.ok) return;
    if (result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    if (result.formError || !result.fieldErrors) {
      setFormError(result.formError ?? 'Something went wrong. Please try again.');
    }
  });

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-relaxed text-graphite-700">
        <li>Open an authenticator app (1Password, Google Authenticator, Authy…).</li>
        <li>Scan this code, or type the key below.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <QrCode value={setup.otpauthUri} className="size-44 shrink-0" />
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-graphite-500">
            Setup key
          </p>
          <p className="mt-1 font-mono text-[14px] tracking-[0.06em] text-ink select-all">
            {groupSecret(setup.secret)}
          </p>
        </div>
      </div>
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <TextField
            control={form.control}
            name="code"
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="max-w-[180px] font-mono tracking-[0.2em]"
          />
          {formError ? <FormError>{formError}</FormError> : null}
          <div className="flex items-center gap-4">
            <Button variant="primary" size="sm" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Checking…' : 'Turn on'}
            </Button>
            {onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </Form>
    </div>
  );
}
