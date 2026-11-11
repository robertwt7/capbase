'use client';

import { useState, useTransition } from 'react';

import { LogoMark } from '@/components/Logo';
import { Button, Card, FormError } from '@/components/ui';

import { verifyClaimAction } from './actions';

/**
 * Spends the claim link only when the button is pressed, never on load: mail scanners open
 * every link in an email, and would otherwise complete a claim nobody confirmed.
 */
export function VerifyClaimForm({ token }: { token: string }) {
  const [formError, setFormError] = useState<string>();
  const [done, setDone] = useState<{ companySlug: string; companyName: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    setFormError(undefined);
    startTransition(async () => {
      const result = await verifyClaimAction(token);
      if (result.ok) setDone({ companySlug: result.companySlug, companyName: result.companyName });
      else setFormError(result.formError);
    });
  };

  return (
    <div className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        {done ? (
          <div className="flex flex-col gap-3.5 p-8" role="status">
            <LogoMark className="mb-1 h-7 self-start text-ink" />
            <h1 className="font-display text-[22px] font-bold text-ink">Claim confirmed</h1>
            <p className="font-sans text-[13px] text-graphite-500">
              You&apos;re now listed as a verified representative of {done.companyName}. Edits you
              send are still reviewed before they go live.
            </p>
            <Button variant="primary" block href={`/companies/${done.companySlug}`}>
              Go to {done.companyName}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 p-8">
            <LogoMark className="mb-1 h-7 self-start text-ink" />
            <h1 className="font-display text-[22px] font-bold text-ink">Confirm your claim</h1>
            <p className="font-sans text-[13px] text-graphite-500">
              Press the button to finish claiming the company this link was sent for. Didn&apos;t
              ask for it? Close this page and nothing happens.
            </p>

            {formError ? <FormError>{formError}</FormError> : null}

            <Button variant="primary" block type="button" onClick={onConfirm} disabled={pending}>
              {pending ? 'Confirming…' : 'Confirm the claim'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
