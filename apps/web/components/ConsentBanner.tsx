'use client';

import { GoogleAnalytics } from '@next/third-parties/google';
import { useEffect, useState } from 'react';

import { Button } from './ui';

export const CONSENT_COOKIE = 'capbase_consent';
/** Fired by "Cookie preferences" in the footer to bring the banner back. */
export const CONSENT_REOPEN_EVENT = 'capbase:consent-reopen';

type Consent = 'granted' | 'denied';
const MAX_AGE = 60 * 60 * 24 * 180; // ask again after ~6 months

function readConsent(): Consent | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CONSENT_COOKIE}=(granted|denied)`),
  );
  return (match?.[1] as Consent | undefined) ?? null;
}

/** Expire GA's own cookies on withdrawal; GA only ever sets them on the apex. */
function clearAnalyticsCookies() {
  const domain = window.location.hostname.replace(/^www\./, '');
  for (const pair of document.cookie.split('; ')) {
    const name = pair.split('=')[0] ?? '';
    if (name === '_ga' || name.startsWith('_ga_')) {
      document.cookie = `${name}=; Max-Age=0; path=/`;
      document.cookie = `${name}=; Max-Age=0; path=/; domain=.${domain}`;
    }
  }
}

/**
 * Opt-in consent for Google Analytics. GA's script is not rendered — so no
 * request leaves the page and no `_ga` cookie is set — until the visitor
 * accepts. Declining is remembered just as long as accepting. Renders nothing
 * at all when no GA id is configured: there is then nothing to consent to.
 */
export function ConsentBanner({ gaId }: { gaId?: string }) {
  // undefined until mounted: the cookie is only readable client-side, and
  // rendering the banner during SSR would flash it at visitors who chose.
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);

  useEffect(() => {
    setConsent(readConsent());
    const reopen = () => setConsent(null);
    window.addEventListener(CONSENT_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_REOPEN_EVENT, reopen);
  }, []);

  if (!gaId) return null;

  const choose = (value: Consent) => {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${MAX_AGE}; path=/; SameSite=Lax${secure}`;
    if (value === 'denied') clearAnalyticsCookies();
    setConsent(value);
  };

  return (
    <>
      {consent === 'granted' ? <GoogleAnalytics gaId={gaId} /> : null}
      {consent === null ? (
        <div
          role="region"
          aria-label="Cookie consent"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface"
        >
          <div className="mx-auto flex max-w-(--page-max) flex-wrap items-center gap-x-6 gap-y-3 px-(--page-pad) py-4">
            <p className="min-w-0 flex-1 basis-[28rem] text-sm text-graphite-700">
              We&apos;d like to use Google Analytics cookies to understand how
              Capbase is used. They are off unless you accept. Sign-in uses one
              essential cookie either way.{' '}
              <a
                href="/privacy"
                className="text-ink underline underline-offset-[3px]"
              >
                Privacy policy
              </a>
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <Button
                variant="outline"
                shape="pill"
                size="sm"
                onClick={() => choose('denied')}
              >
                Decline
              </Button>
              <Button
                variant="primary"
                shape="pill"
                size="sm"
                onClick={() => choose('granted')}
              >
                Accept analytics
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Footer link that reopens the banner so a choice can be changed. */
export function CookiePreferencesButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT))}
    >
      Cookie preferences
    </button>
  );
}
