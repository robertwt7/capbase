'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { MfaMethod } from '@repo/api';

import { Button, Form, FormError, TextField } from '@/components/ui';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import {
  recoveryCodeDefaults,
  recoveryCodeSchema,
  totpCodeDefaults,
  totpCodeSchema,
  totpDigits,
  type RecoveryCodeValues,
  type TotpCodeValues,
} from '@/lib/validation/mfa';
import { isPasskeyCancel, passkeyErrorMessage } from '@/lib/webauthn';

type StepError = { message: string; expired?: boolean };

/** POST to a sign-in route; resolves to null on success or the error to show. */
async function post(path: string, body?: unknown): Promise<{ data: Record<string, unknown>; error: StepError | null }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { data, error: null };
  return {
    data,
    error: {
      message:
        typeof data.message === 'string'
          ? data.message
          : res.status === 429
            ? RATE_LIMITED_MESSAGE
            : 'Something went wrong. Please try again.',
      expired: data.expired === true,
    },
  };
}

/**
 * The second sign-in step, rendered in place of the password form: a passkey button, a 6-digit
 * code (submitted as soon as six digits are in), or a recovery code. The challenge itself lives
 * in an httpOnly cookie the route handlers read. `admin` makes the completion refuse a
 * non-admin (the /admin/login rule).
 */
export function SecondFactorStep({
  methods,
  admin = false,
  onSuccess,
  onRestart,
}: {
  methods: MfaMethod[];
  admin?: boolean;
  onSuccess: () => void;
  onRestart: () => void;
}) {
  const hasTotp = methods.includes('totp');
  const hasRecovery = methods.includes('recovery');
  const hasPasskey = methods.includes('passkey');
  // With a passkey and no app, the passkey button is the step; the code form waits for a click.
  const [mode, setMode] = useState<'totp' | 'recovery' | 'none'>(
    hasTotp ? 'totp' : hasPasskey ? 'none' : 'recovery',
  );
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [error, setError] = useState<StepError>();
  const [busy, setBusy] = useState(false);
  // Read after mount: the server render can't know the browser.
  useEffect(() => {
    const supported = hasPasskey && browserSupportsWebAuthn();
    setPasskeyReady(supported);
    if (!supported) setMode((m) => (m === 'none' ? 'recovery' : m));
  }, [hasPasskey]);

  const totpForm = useForm<TotpCodeValues>({
    resolver: zodResolver(totpCodeSchema),
    defaultValues: totpCodeDefaults,
  });
  const recoveryForm = useForm<RecoveryCodeValues>({
    resolver: zodResolver(recoveryCodeSchema),
    defaultValues: recoveryCodeDefaults,
  });

  const verify = async (body: Record<string, unknown>) => {
    setError(undefined);
    const { error: failed } = await post('/api/auth/login/mfa', { ...body, admin });
    if (failed) {
      setError(failed);
      return false;
    }
    onSuccess();
    return true;
  };

  const submitTotp = totpForm.handleSubmit(async (values) => {
    if (!(await verify({ method: 'totp', code: totpDigits(values.code) }))) {
      totpForm.reset(totpCodeDefaults);
      totpForm.setFocus('code');
    }
  });
  const submitRecovery = recoveryForm.handleSubmit(async (values) => {
    await verify({ method: 'recovery', code: values.code });
  });

  // Six digits typed (or pasted, or autofilled from the OS) is the whole answer.
  const code = totpForm.watch('code');
  useEffect(() => {
    if (
      mode === 'totp' &&
      !totpForm.formState.isSubmitting &&
      /^\d{3}\s?\d{3}$/.test(code.trim())
    ) {
      void submitTotp();
    }
    // submitTotp is rebuilt each render; the code is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, mode]);

  const usePasskey = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const { data, error: failed } = await post('/api/auth/login/mfa/passkey-options');
      if (failed) {
        setError(failed);
        return;
      }
      let response;
      try {
        response = await startAuthentication({
          optionsJSON: data.options as PublicKeyCredentialRequestOptionsJSON,
        });
      } catch (err) {
        if (!isPasskeyCancel(err)) setError({ message: passkeyErrorMessage(err) });
        return;
      }
      await verify({ method: 'passkey', response });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-[22px] font-bold text-ink">Two-factor authentication</h1>
        <p className="mt-1 font-sans text-[13px] text-graphite-500">
          {passkeyReady
            ? mode === 'none'
              ? 'Confirm it’s you with your passkey.'
              : 'Use your passkey, or enter a code.'
            : mode === 'totp'
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Enter one of your recovery codes. Each works once.'}
        </p>
      </div>

      {passkeyReady ? (
        <Button variant="primary" block onClick={usePasskey} disabled={busy}>
          {busy ? 'Waiting for your device…' : 'Use your passkey'}
        </Button>
      ) : null}

      {mode === 'totp' && hasTotp ? (
        <Form {...totpForm}>
          <form onSubmit={submitTotp} noValidate className="flex flex-col gap-3.5">
            <TextField
              control={totpForm.control}
              name="code"
              label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus={!passkeyReady}
              maxLength={7}
              className="font-mono tracking-[0.2em]"
            />
            <Button
              variant={passkeyReady ? 'outline' : 'primary'}
              block
              type="submit"
              disabled={totpForm.formState.isSubmitting}
            >
              {totpForm.formState.isSubmitting ? 'Checking…' : 'Verify'}
            </Button>
          </form>
        </Form>
      ) : null}

      {mode === 'recovery' && hasRecovery ? (
        <Form {...recoveryForm}>
          <form onSubmit={submitRecovery} noValidate className="flex flex-col gap-3.5">
            <TextField
              control={recoveryForm.control}
              name="code"
              label="Recovery code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              className="font-mono tracking-[0.08em]"
            />
            <Button
              variant={passkeyReady ? 'outline' : 'primary'}
              block
              type="submit"
              disabled={recoveryForm.formState.isSubmitting}
            >
              {recoveryForm.formState.isSubmitting ? 'Checking…' : 'Verify'}
            </Button>
          </form>
        </Form>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-2">
          <FormError>{error.message}</FormError>
          {error.expired ? (
            <Button variant="outline" block onClick={onRestart}>
              Start again
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col items-start gap-1.5 pt-1">
        {mode !== 'recovery' && hasRecovery ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(undefined);
              setMode('recovery');
            }}
          >
            Use a recovery code instead
          </Button>
        ) : null}
        {mode === 'recovery' && hasTotp ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(undefined);
              setMode('totp');
            }}
          >
            Use your authenticator app instead
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onRestart} className="text-graphite-500">
          Back to sign in
        </Button>
      </div>
    </div>
  );
}
