'use client';

import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { TotpEnrollStep } from '@/components/auth/TotpEnrollStep';
import { LogoMark } from '@/components/Logo';
import { RecoveryCodesPanel } from '@/components/RecoveryCodesPanel';
import { Button, Card, FormError } from '@/components/ui';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import type { TotpCodeValues } from '@/lib/validation/mfa';
import { totpDigits } from '@/lib/validation/mfa';
import type { ActionResult } from '@/lib/validation/utils';
import { isPasskeyCancel, passkeyErrorMessage } from '@/lib/webauthn';

type Failure = { message: string; expired?: boolean };

async function post(path: string, body?: unknown): Promise<{ data: Record<string, unknown>; error: Failure | null }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { data, error: null };
  const message =
    typeof data.message === 'string'
      ? data.message
      : res.status === 429
        ? RATE_LIMITED_MESSAGE
        : 'Something went wrong. Please try again.';
  return { data, error: { message, expired: data.expired === true } };
}

type Totp = { secret: string; otpauthUri: string; totpChallenge: string };

/**
 * Enroll a first factor before any session exists: a passkey (one tap) or an authenticator
 * app. Finishing signs the user in and shows the recovery codes once; Continue goes on to `next`.
 */
export function SetupTwoFactor({ next }: { next: string }) {
  const router = useRouter();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [totp, setTotp] = useState<Totp>();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<Failure>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  const finish = (data: Record<string, unknown>) => {
    const fresh = Array.isArray(data.recoveryCodes) ? (data.recoveryCodes as string[]) : [];
    if (fresh.length > 0) setCodes(fresh);
    else proceed();
  };
  const proceed = () => {
    router.replace(next);
    router.refresh();
  };

  const addPasskey = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const { data, error: failed } = await post('/api/auth/login/setup/passkey-options');
      if (failed) return setError(failed);
      let response;
      try {
        response = await startRegistration({
          optionsJSON: data.options as PublicKeyCredentialCreationOptionsJSON,
        });
      } catch (err) {
        if (!isPasskeyCancel(err)) setError({ message: passkeyErrorMessage(err) });
        return;
      }
      const done = await post('/api/auth/login/setup/passkey', {
        registerChallenge: data.registerChallenge,
        response,
        name: 'Passkey',
      });
      if (done.error) return setError(done.error);
      finish(done.data);
    } finally {
      setBusy(false);
    }
  };

  const startApp = async () => {
    setError(undefined);
    setBusy(true);
    const { data, error: failed } = await post('/api/auth/login/setup/totp');
    setBusy(false);
    if (failed) return setError(failed);
    setTotp(data as unknown as Totp);
  };

  const confirmApp = async (values: TotpCodeValues): Promise<ActionResult> => {
    if (!totp) return { ok: false, formError: 'Start again.' };
    const { data, error: failed } = await post('/api/auth/login/setup/totp/confirm', {
      totpChallenge: totp.totpChallenge,
      code: totpDigits(values.code),
    });
    if (failed) {
      if (failed.expired) setError(failed);
      return failed.expired
        ? { ok: false, formError: failed.message }
        : { ok: false, fieldErrors: { code: failed.message } };
    }
    finish(data);
    return { ok: true };
  };

  return (
    <div className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[460px]">
        <div className="flex flex-col gap-4 p-8">
          <LogoMark className="mb-1 h-7 self-start text-ink" />
          {codes ? (
            <>
              <h1 className="font-display text-[22px] font-bold text-ink">You’re all set</h1>
              <p className="font-sans text-[13px] text-graphite-500">
                Two-factor authentication is on. Save these codes before you continue.
              </p>
              <RecoveryCodesPanel codes={codes} />
              <Button variant="primary" block onClick={proceed}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <h1 className="font-display text-[22px] font-bold text-ink">
                Set up two-factor authentication
              </h1>
              <p className="font-sans text-[13px] leading-relaxed text-graphite-500">
                Your account can publish data, so it needs a second step after your password.
                Add one to finish signing in.
              </p>

              {totp ? (
                <TotpEnrollStep setup={totp} onConfirm={confirmApp} onCancel={() => setTotp(undefined)} />
              ) : (
                <div className="flex flex-col gap-3">
                  {supported !== false ? (
                    <Button variant="primary" block onClick={addPasskey} disabled={busy || supported === null}>
                      {busy ? 'Waiting for your device…' : 'Add a passkey'}
                    </Button>
                  ) : null}
                  <Button
                    variant={supported === false ? 'primary' : 'outline'}
                    block
                    onClick={startApp}
                    disabled={busy}
                  >
                    Use an authenticator app
                  </Button>
                  {supported === false ? (
                    <p className="text-[13px] text-graphite-500">
                      This browser doesn’t support passkeys; an authenticator app works anywhere.
                    </p>
                  ) : null}
                </div>
              )}

              {error ? <FormError>{error.message}</FormError> : null}
              {error?.expired ? (
                <Button variant="outline" block href={`/login?next=${encodeURIComponent(next)}`}>
                  Start again
                </Button>
              ) : null}

              <Link
                href="/login"
                className="self-start font-sans text-[13px] text-graphite-500 underline underline-offset-[3px] hover:text-ink"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
