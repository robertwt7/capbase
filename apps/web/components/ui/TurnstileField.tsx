'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Cloudflare Turnstile challenge for forms a bot would want to automate
 * (registration, contributions). Renders nothing without a site key, so dev and
 * CI need no Cloudflare account — the API skips its check the same way when
 * `TURNSTILE_SECRET` is unset.
 *
 * A token is single-use: after every submit attempt the parent remounts this
 * (change its `key`) to get a fresh challenge.
 */
export function TurnstileField({
  siteKey,
  onToken,
  className,
}: {
  siteKey?: string;
  onToken: (token: string | null) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(
    () => typeof window !== 'undefined' && Boolean(window.turnstile),
  );
  // Latest callback without re-rendering the widget when the parent re-renders.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !ready || !container.current || !window.turnstile) return;
    const id = window.turnstile.render(container.current, {
      sitekey: siteKey,
      theme: 'light',
      appearance: 'interaction-only',
      callback: (token: string) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => onTokenRef.current(null),
    });
    return () => window.turnstile?.remove(id);
  }, [siteKey, ready]);

  if (!siteKey) return null;
  return (
    <>
      <Script src={SCRIPT_SRC} strategy="afterInteractive" onReady={() => setReady(true)} />
      <div ref={container} className={cn('min-h-0 empty:hidden', className)} />
    </>
  );
}
