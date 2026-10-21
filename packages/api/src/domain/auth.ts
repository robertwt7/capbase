/** CONTRIBUTOR is granted by an admin only: it may mint contributor API keys for /v1 and always
 *  sees complete company profiles, but moderates nothing. */
export type Role = 'USER' | 'CONTRIBUTOR' | 'ADMIN';

export const ROLES: readonly Role[] = ['USER', 'CONTRIBUTOR', 'ADMIN'];

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** False until the user spends a verification link (and again after an email change). */
  emailVerified: boolean;
  /** True while the account has a second factor (an authenticator app or a passkey). */
  mfaEnabled: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

// --- Two-factor authentication & passkeys ------------------------------------

/** `code` on the 403 a /v1 key gets when its owner's role requires 2FA and they have none. */
export const MFA_REQUIRED = 'MFA_REQUIRED';
/** Wrong codes allowed on one challenge before it is spent. */
export const MFA_MAX_ATTEMPTS = 5;
/** Failed second-factor attempts per account, across challenges, before a lockout. */
export const MFA_ACCOUNT_FAILURE_LIMIT = 10;
export const MFA_LOCKOUT_MINUTES = 15;
/** How long a sign-in step (a challenge) stays usable. */
export const MFA_CHALLENGE_MINUTES = 5;
export const RECOVERY_CODE_COUNT = 10;
export const MAX_PASSKEYS = 10;
export const PASSKEY_NAME_MAX = 60;

export type MfaMethod = 'totp' | 'passkey' | 'recovery';
export const MFA_METHODS: readonly MfaMethod[] = ['totp', 'passkey', 'recovery'];

export type AuthChallengePurpose =
  | 'LOGIN_MFA'
  | 'MFA_SETUP'
  | 'TOTP_ENROLL'
  | 'PASSKEY_REGISTER'
  | 'PASSKEY_LOGIN';

/**
 * POST /auth/login. `ok` is a session; `mfa` asks for a second factor on `challenge`;
 * `mfa_setup` means the account's role requires 2FA and it has none — no session until one is
 * enrolled on `challenge`.
 */
export type LoginResponse =
  | ({ status: 'ok' } & AuthResponse)
  | { status: 'mfa'; challenge: string; methods: MfaMethod[] }
  | { status: 'mfa_setup'; challenge: string };

export interface MfaVerifyInput {
  challenge: string;
  method: MfaMethod;
  /** TOTP or recovery code. */
  code?: string;
  /** WebAuthn AuthenticationResponseJSON, for method 'passkey'. */
  response?: Record<string, unknown>;
}

export interface PasskeySummary {
  id: string;
  name: string;
  deviceType: 'singleDevice' | 'multiDevice';
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MfaStatus {
  totpEnabled: boolean;
  passkeys: PasskeySummary[];
  recoveryCodesRemaining: number;
  /** True when this account's role is in MFA_REQUIRED_ROLES (the last factor can't be removed). */
  required: boolean;
}

/** A pending authenticator-app enrollment: confirm it with a code on `challenge`. */
export interface TotpSetup {
  challenge: string;
  /** Base32, for typing in by hand. */
  secret: string;
  otpauthUri: string;
}

/** Plaintext recovery codes — sent once, never stored. Empty when the account already had some. */
export interface RecoveryCodes {
  recoveryCodes: string[];
}

/** A finished forced enrollment: the session plus the codes to show once. */
export type SetupCompleteResponse = { status: 'ok' } & AuthResponse & RecoveryCodes;

export interface PasswordConfirmInput {
  password: string;
}

/** WebAuthn options JSON (PublicKeyCredential{Creation,Request}OptionsJSON) for the browser. */
export type WebAuthnOptionsJSON = Record<string, unknown>;

/** Options for a ceremony bound to a fresh challenge token. */
export interface PasskeyOptions {
  challenge: string;
  options: WebAuthnOptionsJSON;
}

export interface ChallengeInput {
  challenge: string;
}

export interface TotpConfirmInput {
  challenge: string;
  code: string;
}

/** Forced setup: `challenge` is the MFA_SETUP token, `totpChallenge` the enrollment's. */
export interface SetupTotpConfirmInput {
  challenge: string;
  totpChallenge: string;
  code: string;
}

export interface PasskeyRegisterInput {
  challenge: string;
  /** WebAuthn RegistrationResponseJSON. */
  response: Record<string, unknown>;
  name: string;
}

export interface SetupPasskeyOptions {
  registerChallenge: string;
  options: WebAuthnOptionsJSON;
}

/** Forced setup: `challenge` is the MFA_SETUP token, `registerChallenge` the registration's. */
export interface SetupPasskeyInput {
  challenge: string;
  registerChallenge: string;
  /** WebAuthn RegistrationResponseJSON. */
  response: Record<string, unknown>;
  name: string;
}

export interface PasskeyLoginInput {
  challenge: string;
  /** WebAuthn AuthenticationResponseJSON. */
  response: Record<string, unknown>;
}

export interface UpdateProfileInput {
  name: string;
  email: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

export interface VerifyEmailInput {
  token: string;
}

/** `code` on the 403 a contribution gets from an account that hasn't verified its email. */
export const EMAIL_UNVERIFIED = 'EMAIL_UNVERIFIED';

/** Most PENDING submissions one account may have in the queue at once. Above
 *  it, contributions answer 429 until a moderator catches up. */
export const MAX_PENDING_SUBMISSIONS = 15;

/** Header carrying a Cloudflare Turnstile token from the web to the API. */
export const TURNSTILE_HEADER = 'x-turnstile-token';

/** One account as the admin user list shows it. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** ISO timestamp, or null when the account is in good standing. */
  bannedAt: string | null;
  createdAt: string;
  pendingCount: number;
  /** Whether the account has a second factor. */
  mfaEnabled: boolean;
}

export interface AdminUserListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

/** PATCH /admin/users/:id — either field may be sent alone. */
export interface UpdateUserInput {
  banned?: boolean;
  role?: Role;
}
