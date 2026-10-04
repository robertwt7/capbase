'use client';

import { useState, useTransition } from 'react';

import { resendVerificationAction } from '@/app/(account)/actions';
import { Button, FormError } from '@/components/ui';

/** "Resend link" on the verify-email banner. The API allows one link a minute. */
export function ResendVerificationButton() {
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const [pending, startTransition] = useTransition();

  const onResend = () => {
    setResult(undefined);
    startTransition(async () => setResult(await resendVerificationAction()));
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button variant="outline" size="sm" type="button" onClick={onResend} disabled={pending}>
        {pending ? 'Sending…' : 'Resend link'}
      </Button>
      {result?.ok ? (
        <p role="status" className="font-sans text-[13px] text-graphite-500">
          {result.message}
        </p>
      ) : null}
      {result && !result.ok ? <FormError className="text-[13px]">{result.message}</FormError> : null}
    </div>
  );
}
