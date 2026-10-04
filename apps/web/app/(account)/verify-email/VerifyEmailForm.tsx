'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { LogoMark } from '@/components/Logo';
import { Button, Card, FormError } from '@/components/ui';

import { verifyEmailAction } from './actions';

/**
 * Spends the token only when the button is pressed, never on load: mail
 * scanners (Outlook Safe Links and others) open every link in an email, and
 * would otherwise use the token up before the person ever clicks it.
 */
export function VerifyEmailForm({ token }: { token: string }) {
  const [formError, setFormError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    setFormError(undefined);
    startTransition(async () => {
      const result = await verifyEmailAction(token);
      if (result.ok) setDone(true);
      else setFormError(result.formError);
    });
  };

  return (
    <div className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        {done ? (
          <div className="flex flex-col gap-3.5 p-8" role="status">
            <LogoMark className="mb-1 h-7 self-start text-ink" />
            <h1 className="font-display text-[22px] font-bold text-ink">Email confirmed</h1>
            <p className="font-sans text-[13px] text-graphite-500">
              You can now contribute companies, rounds and people.
            </p>
            <Button variant="primary" block href="/contribute">
              Start contributing
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 p-8">
            <LogoMark className="mb-1 h-7 self-start text-ink" />
            <h1 className="font-display text-[22px] font-bold text-ink">Confirm your email</h1>
            <p className="font-sans text-[13px] text-graphite-500">
              One click and your account can start contributing to Capbase.
            </p>

            {formError ? <FormError>{formError}</FormError> : null}

            <Button variant="primary" block type="button" onClick={onConfirm} disabled={pending}>
              {pending ? 'Confirming…' : 'Confirm my email'}
            </Button>

            {formError ? (
              <p className="mt-1 text-center font-sans text-[13px] text-graphite-500">
                Need a new link?{' '}
                <Link className="font-semibold text-ink underline" href="/profile">
                  Resend from your profile
                </Link>
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
