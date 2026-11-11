'use client';

import { useState, useTransition } from 'react';

import { confirmCurrentAction } from '@/app/companies/[slug]/actions';
import { Button } from '@/components/ui';

/** The representative's "Confirm still current" action. Disabled for the day once pressed; the
 *  server action revalidates the profile, so the confirmed date appears after it settles. */
export function ConfirmCurrentButton({
  slug,
  canConfirm,
  className,
}: {
  slug: string;
  canConfirm: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <span className={className}>
      <Button
        variant="outline"
        shape="pill"
        size="sm"
        disabled={!canConfirm || pending}
        title={error ?? 'Record that the facts on this profile are still current'}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await confirmCurrentAction(slug);
            if (!result.ok) setError(result.formError);
          })
        }
      >
        {pending ? 'Confirming…' : canConfirm ? 'Confirm still current' : 'Confirmed today'}
      </Button>
      {error ? (
        <span role="alert" className="sr-only">
          {error}
        </span>
      ) : null}
    </span>
  );
}
