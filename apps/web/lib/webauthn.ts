// Client-safe helpers around @simplewebauthn/browser.

/** True when the user dismissed the browser's passkey sheet — not an error worth shouting. */
export function isPasskeyCancel(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return (
    error.name === 'NotAllowedError' ||
    error.name === 'AbortError' ||
    code === 'ERROR_CEREMONY_ABORTED'
  );
}

/** What to show when a passkey ceremony throws in the browser. */
export function passkeyErrorMessage(error: unknown): string {
  if (isPasskeyCancel(error)) return 'Passkey request cancelled.';
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return 'This device already has a passkey for your account.';
  }
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID') {
    return 'Passkeys don’t work on this address. Use the main site.';
  }
  return 'Your browser couldn’t use a passkey. Try again or use another method.';
}
