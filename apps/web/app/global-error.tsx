'use client';

import { useEffect } from 'react';

import './globals.css';

// Replaces the root layout when the layout itself throws, so it renders its
// own <html>/<body> and leans only on globals.css (no header, footer or fonts).
export default function GlobalError({
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
    <html lang="en">
      <body className="bg-paper text-ink antialiased">
        <main className="mx-auto max-w-[70ch] px-6 pt-20 pb-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite-500">
            Error
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Capbase is unavailable</h1>
          <p className="mt-4 text-graphite-700">
            Something went wrong on our side. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
