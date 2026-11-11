'use client';
import { useState, useTransition } from 'react';
import { Button, Card, FormError } from '@/components/ui';
import { setDigestAction } from './digest-actions';
export function DigestPreference({
  enabled,
  canEnable,
}: {
  enabled: boolean;
  canEnable: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  return (
    <Card className="mt-8 p-6">
      <h2 className="font-display font-semibold">Weekly email</h2>
      <p className="my-3 text-sm text-graphite-500">
        A weekly summary of your monitored searches and saved companies. Email
        is separate from monitoring and starts off. Funding dates describe the
        recorded financing, not when it was added.
      </p>
      {canEnable || on ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(undefined);
              setSaved(false);
              const result = await setDigestAction(!on);
              if (result.ok) {
                setOn(!on);
                setSaved(true);
              } else setError(result.formError);
            })
          }
        >
          {on ? 'Turn weekly email off' : 'Enable weekly email'}
        </Button>
      ) : (
        <p className="text-sm text-graphite-500">
          Current full access and a verified email are required to enable weekly
          email.
        </p>
      )}
      {error ? <FormError>{error}</FormError> : null}
      <p role="status" className="mt-3 text-sm">
        {saved ? (on ? 'Weekly email enabled.' : 'Weekly email off.') : null}
      </p>
    </Card>
  );
}
