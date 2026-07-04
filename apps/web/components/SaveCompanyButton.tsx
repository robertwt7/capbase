'use client';

import { useTransition } from 'react';

import { setSavedAction } from '@/app/companies/[slug]/actions';
import { Button } from '@/components/ui';

/** Save/Saved watchlist toggle shown on the company page for signed-in users.
    The server action revalidates the page, so `saved` refreshes after the
    transition settles. */
export function SaveCompanyButton({ slug, saved }: { slug: string; saved: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={saved ? 'primary' : 'outline'}
      shape="pill"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setSavedAction(slug, !saved);
        })
      }
    >
      {saved ? 'Saved' : 'Save'}
    </Button>
  );
}
