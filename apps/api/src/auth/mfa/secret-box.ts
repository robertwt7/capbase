import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secrets stored at rest (TOTP seeds). Format `v1.<iv>.<tag>.<ciphertext>`,
 * each part base64url — the version prefix leaves room for a key rotation later.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
export const MFA_KEY_BYTES = 32;

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Decrypt a `seal` output. Throws on a wrong key, a tampered part or an unknown format. */
export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new Error('Unrecognised sealed secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * The key from `MFA_ENCRYPTION_KEY` (base64, 32 bytes). Production requires it (validateEnv);
 * elsewhere, when unset, it is derived from JWT_SECRET so local dev and CI need no new env.
 * Changing either one makes every stored authenticator secret unreadable.
 */
export function mfaKey(env: {
  MFA_ENCRYPTION_KEY?: string;
  JWT_SECRET?: string;
  NODE_ENV?: string;
}): Buffer {
  if (env.MFA_ENCRYPTION_KEY) {
    const key = Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64');
    if (key.length !== MFA_KEY_BYTES) {
      throw new Error(`MFA_ENCRYPTION_KEY must decode to ${MFA_KEY_BYTES} bytes`);
    }
    return key;
  }
  if (env.NODE_ENV === 'production') throw new Error('MFA_ENCRYPTION_KEY is required in production');
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required to derive the MFA key');
  return Buffer.from(
    hkdfSync('sha256', env.JWT_SECRET, 'capbase', 'mfa-encryption-key', MFA_KEY_BYTES),
  );
}
