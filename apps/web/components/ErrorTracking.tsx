'use client';

import { useEffect } from 'react';

import { initClientErrorTracking } from '@/lib/sentry-client';

/** Starts browser error tracking when the root layout hands it a DSN. A DSN is
 *  public by design (it can only submit events), so it travels as a prop. */
export function ErrorTracking({ dsn, release }: { dsn?: string; release?: string }) {
  useEffect(() => {
    if (dsn) initClientErrorTracking(dsn, release);
  }, [dsn, release]);
  return null;
}
