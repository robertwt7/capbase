'use client';

import { useEffect } from 'react';

import { Button, EmptyState, Eyebrow, PageContainer } from '@/components/ui';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer className="pt-14 pb-20">
      <Eyebrow>Error</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
        We couldn&apos;t load this page
      </h1>
      <EmptyState
        className="mt-7 max-w-[70ch]"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={reset}>
              Try again
            </Button>
            <Button href="/" variant="outline" size="sm">
              Go home
            </Button>
          </div>
        }
      >
        The data service didn&apos;t answer. This is usually brief — try again in a moment.
        {error.digest ? (
          <span className="mt-2 block font-mono text-xs text-graphite-500">Ref {error.digest}</span>
        ) : null}
      </EmptyState>
    </PageContainer>
  );
}
