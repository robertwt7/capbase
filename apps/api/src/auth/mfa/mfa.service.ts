import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MFA_ACCOUNT_FAILURE_LIMIT,
  MFA_CHALLENGE_MINUTES,
  MFA_LOCKOUT_MINUTES,
  MFA_MAX_ATTEMPTS,
  type AuthChallengePurpose,
  type MfaMethod,
  type MfaStatus,
  type PasskeySummary,
  type Role,
  type TotpSetup,
} from '@repo/api';
import type { AuthChallenge, Prisma } from '@repo/db';

import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from './hash';
import { MfaPolicy } from './policy';
import { generateRecoveryCodes, normalizeRecoveryCode } from './recovery-codes';
import { mfaKey, open, seal } from './secret-box';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

const MINUTE = 60_000;
/** Forced enrollment may mean installing an authenticator app first; every other step is one
 *  prompt, so it gets MFA_CHALLENGE_MINUTES. */
const SETUP_CHALLENGE_MINUTES = 15;
/** Spent and expired challenges are deleted once they are this old (on each insert). */
const PRUNE_AFTER_MS = 60 * MINUTE;

export const EXPIRED_MESSAGE = 'This sign-in has expired. Start again.';
export const BAD_CODE_MESSAGE = "That code didn't work.";
export const LOCKED_MESSAGE = `Too many failed two-factor attempts. Try again in ${MFA_LOCKOUT_MINUTES} minutes.`;
export const LAST_FACTOR_MESSAGE =
  'Your role requires two-factor authentication. Add another method before removing this one.';

/** The User columns MFA reads. `findById`/`findByEmail` return the whole row, which fits. */
export type MfaUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  mfaEnabledAt: Date | null;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
};

/** The sentences `security-notice` emails carry. */
export const SecurityEvent = {
  totpAdded: 'An authenticator app was added to your account.',
  totpRemoved: 'The authenticator app was removed from your account.',
  passkeyAdded: (name: string) => `A passkey ("${name}") was added to your account.`,
  passkeyRemoved: (name: string) => `A passkey ("${name}") was removed from your account.`,
  codesRegenerated: 'New recovery codes were generated. The old ones no longer work.',
  codeUsed: (remaining: number) =>
    `A recovery code was used to sign in. You have ${remaining} left${
      remaining === 0 ? ' — generate new ones now' : ''
    }.`,
  repeatedFailures:
    'There were several failed two-factor attempts on your account, so your password may be known to someone else. Change it.',
  adminReset:
    'Two-factor authentication was reset by an administrator. Every method and recovery code was removed, and you were signed out everywhere.',
} as const;

/**
 * Every 2FA state transition: the short-lived challenges between sign-in steps, the
 * authenticator app (TOTP), recovery codes, and the shared bookkeeping passkeys use
 * (`mfaEnabledAt`, the last-factor rule). Each method takes a user id, so the signed-in routes
 * (`/auth/me/…`) and forced setup (`/auth/login/setup/…`) share them.
 */
@Injectable()
export class MfaService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly policy: MfaPolicy,
    config: ConfigService,
  ) {
    this.key = mfaKey({
      MFA_ENCRYPTION_KEY: config.get<string>('MFA_ENCRYPTION_KEY') || undefined,
      JWT_SECRET: config.get<string>('JWT_SECRET'),
      NODE_ENV: config.get<string>('NODE_ENV'),
    });
  }

  // --- Challenges -------------------------------------------------------------

  /** Mint an opaque single-use token (43 chars) for one step; only its sha256 is stored. */
  async createChallenge(
    purpose: AuthChallengePurpose,
    userId: string | null,
    extra: { pendingSecret?: string; webauthnChallenge?: string } = {},
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const minutes = purpose === 'MFA_SETUP' ? SETUP_CHALLENGE_MINUTES : MFA_CHALLENGE_MINUTES;
    await this.prisma.$transaction([
      // Opportunistic pruning on the expiresAt index keeps the table to the last hour.
      this.prisma.authChallenge.deleteMany({
        where: { expiresAt: { lt: new Date(now - PRUNE_AFTER_MS) } },
      }),
      this.prisma.authChallenge.create({
        data: {
          tokenHash: hashToken(token),
          purpose,
          userId,
          expiresAt: new Date(now + minutes * MINUTE),
          ...extra,
        },
      }),
    ]);
    return token;
  }

  /** A live challenge for this purpose, or 401 — the same answer whatever was wrong with it. */
  async loadChallenge(token: string, purpose: AuthChallengePurpose): Promise<AuthChallenge> {
    const row = await this.prisma.authChallenge.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !row ||
      row.purpose !== purpose ||
      row.consumedAt ||
      row.expiresAt.getTime() <= Date.now() ||
      row.attempts >= MFA_MAX_ATTEMPTS
    ) {
      throw new UnauthorizedException(EXPIRED_MESSAGE);
    }
    return row;
  }

  /** Spend a challenge. Conditional, so of two concurrent completions only one wins. */
  async consumeChallenge(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    const spent = await tx.authChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (spent.count !== 1) throw new UnauthorizedException(EXPIRED_MESSAGE);
  }

  /** Store the WebAuthn challenge issued for this step (passkey options). */
  async attachWebauthnChallenge(id: string, webauthnChallenge: string): Promise<void> {
    await this.prisma.authChallenge.update({ where: { id }, data: { webauthnChallenge } });
  }

  /**
   * Count a wrong second factor on this challenge. On a sign-in challenge it also counts toward
   * the account lockout, and the attempt that reaches MFA_ACCOUNT_FAILURE_LIMIT emails the owner
   * once: getting this far means the password was right.
   */
  async recordFailure(challenge: AuthChallenge): Promise<void> {
    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    if (challenge.purpose !== 'LOGIN_MFA' || !challenge.userId) return;
    if ((await this.recentFailures(challenge.userId)) === MFA_ACCOUNT_FAILURE_LIMIT) {
      const user = await this.prisma.user.findUnique({
        where: { id: challenge.userId },
        select: { email: true, name: true },
      });
      if (user) this.notify(user, SecurityEvent.repeatedFailures);
    }
  }

  /** 429 while this account has MFA_ACCOUNT_FAILURE_LIMIT failures inside the lockout window. */
  async assertNotLocked(userId: string): Promise<void> {
    if ((await this.recentFailures(userId)) >= MFA_ACCOUNT_FAILURE_LIMIT) {
      throw new HttpException(LOCKED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Failed second-factor attempts across this user's recent sign-in challenges. */
  private async recentFailures(userId: string): Promise<number> {
    const { _sum } = await this.prisma.authChallenge.aggregate({
      where: {
        userId,
        purpose: 'LOGIN_MFA',
        createdAt: { gte: new Date(Date.now() - MFA_LOCKOUT_MINUTES * MINUTE) },
      },
      _sum: { attempts: true },
    });
    return _sum.attempts ?? 0;
  }

  // --- Status -----------------------------------------------------------------

  /** The second-factor methods a sign-in may offer this user, passkey first. */
  async methodsFor(user: Pick<MfaUser, 'id' | 'totpEnabledAt'>): Promise<MfaMethod[]> {
    const [passkeys, codes] = await Promise.all([
      this.prisma.webAuthnCredential.count({ where: { userId: user.id } }),
      this.prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    ]);
    const methods: MfaMethod[] = [];
    if (passkeys > 0) methods.push('passkey');
    if (user.totpEnabledAt) methods.push('totp');
    if (codes > 0) methods.push('recovery');
    return methods;
  }

  async status(user: Pick<MfaUser, 'id' | 'role' | 'totpEnabledAt'>): Promise<MfaStatus> {
    const [passkeys, recoveryCodesRemaining] = await Promise.all([
      this.prisma.webAuthnCredential.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, deviceType: true, createdAt: true, lastUsedAt: true },
      }),
      this.prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    ]);
    return {
      totpEnabled: user.totpEnabledAt !== null,
      passkeys: passkeys.map(
        (p): PasskeySummary => ({
          id: p.id,
          name: p.name,
          deviceType: p.deviceType === 'multiDevice' ? 'multiDevice' : 'singleDevice',
          createdAt: p.createdAt.toISOString(),
          lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
        }),
      ),
      recoveryCodesRemaining,
      required: this.policy.requires(user.role),
    };
  }

  // --- Authenticator app (TOTP) -------------------------------------------------

  /** Start enrolling: a fresh secret, held encrypted on a TOTP_ENROLL challenge until confirmed. */
  async beginTotp(user: Pick<MfaUser, 'id' | 'email' | 'totpEnabledAt'>): Promise<TotpSetup> {
    if (user.totpEnabledAt) {
      throw new BadRequestException('An authenticator app is already set up.');
    }
    const secret = generateTotpSecret();
    const challenge = await this.createChallenge('TOTP_ENROLL', user.id, {
      pendingSecret: seal(secret, this.key),
    });
    return {
      challenge,
      secret,
      otpauthUri: otpauthUri({ issuer: 'Capbase', account: user.email, secret }),
    };
  }

  /**
   * Finish enrolling with a code from the app. Turns 2FA on and, when the account has no unused
   * recovery codes, returns a fresh set (shown once); otherwise `[]`.
   */
  async confirmTotp(userId: string, token: string, code: string): Promise<string[]> {
    const challenge = await this.loadChallenge(token, 'TOTP_ENROLL');
    if (challenge.userId !== userId || !challenge.pendingSecret) {
      throw new UnauthorizedException(EXPIRED_MESSAGE);
    }
    const secret = open(challenge.pendingSecret, this.key);
    const step = verifyTotp(secret, code.replace(/\s/g, ''), Date.now(), null);
    if (step === null) {
      await this.recordFailure(challenge);
      throw new BadRequestException(
        `${BAD_CODE_MESSAGE} Check that your device's clock is set automatically, then try the newest code.`,
      );
    }
    const { user, codes } = await this.prisma.$transaction(async (tx) => {
      await this.consumeChallenge(challenge.id, tx);
      const enabled = await tx.user.updateMany({
        where: { id: userId, totpEnabledAt: null },
        data: {
          totpSecret: challenge.pendingSecret,
          totpEnabledAt: new Date(),
          totpLastStep: step,
        },
      });
      if (enabled.count !== 1) {
        throw new BadRequestException('An authenticator app is already set up.');
      }
      return this.factorAdded(tx, userId);
    });
    this.notify(user, SecurityEvent.totpAdded);
    return codes;
  }

  /** Remove the authenticator app. Refused when it is a required role's last factor. */
  async disableTotp(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!user.totpEnabledAt) throw new BadRequestException('No authenticator app is set up.');
    const passkeys = await this.prisma.webAuthnCredential.count({ where: { userId } });
    this.assertNotLastFactor(user, passkeys === 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
      });
      await this.factorRemoved(tx, userId);
    });
    this.notify(user, SecurityEvent.totpRemoved);
  }

  // --- Recovery codes -----------------------------------------------------------

  /** Replace every recovery code with a fresh set, returned once. 400 without a factor. */
  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!user.mfaEnabledAt) {
      throw new BadRequestException('Turn on two-factor authentication first.');
    }
    const codes = await this.prisma.$transaction((tx) => this.replaceRecoveryCodes(tx, userId));
    this.notify(user, SecurityEvent.codesRegenerated);
    return codes;
  }

  // --- The second sign-in step ----------------------------------------------------

  /**
   * Check an authenticator or recovery code for a user. Both writes are conditional, so two
   * parallel uses of one code can't both succeed. Passkeys are verified by PasskeyService.
   */
  async verifyCode(user: MfaUser, method: 'totp' | 'recovery', code: string): Promise<boolean> {
    if (method === 'totp') {
      const clean = code.replace(/\s/g, '');
      if (!user.totpSecret || !/^\d{6}$/.test(clean)) return false;
      const step = verifyTotp(open(user.totpSecret, this.key), clean, Date.now(), user.totpLastStep);
      if (step === null) return false;
      const won = await this.prisma.user.updateMany({
        where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      return won.count === 1;
    }

    if (!/^[a-z0-9 -]{10,13}$/i.test(code)) return false;
    const used = await this.prisma.recoveryCode.updateMany({
      where: { userId: user.id, codeHash: hashToken(normalizeRecoveryCode(code)), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) return false;
    const remaining = await this.prisma.recoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });
    this.notify(user, SecurityEvent.codeUsed(remaining));
    return true;
  }

  // --- Shared bookkeeping (TOTP and passkeys) ---------------------------------------

  /**
   * After a factor is added inside `tx`: set `mfaEnabledAt` if this is the first, and issue
   * recovery codes if the account has none unused. Returns the user and the new codes ([] if
   * it already had some).
   */
  async factorAdded(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ user: { email: string; name: string }; codes: string[] }> {
    await tx.user.updateMany({
      where: { id: userId, mfaEnabledAt: null },
      data: { mfaEnabledAt: new Date() },
    });
    const unused = await tx.recoveryCode.count({ where: { userId, usedAt: null } });
    const codes = unused === 0 ? await this.replaceRecoveryCodes(tx, userId) : [];
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, name: true },
    });
    return { user, codes };
  }

  /** After a factor is removed inside `tx`: with none left, 2FA is off and the codes go. */
  async factorRemoved(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const [user, passkeys] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true } }),
      tx.webAuthnCredential.count({ where: { userId } }),
    ]);
    if (user.totpEnabledAt || passkeys > 0) return;
    await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: null } });
    await tx.recoveryCode.deleteMany({ where: { userId } });
  }

  /** 400 when removing a factor would leave a required role with none. */
  assertNotLastFactor(user: Pick<MfaUser, 'role'>, isLast: boolean): void {
    if (isLast && this.policy.requires(user.role)) {
      throw new BadRequestException(LAST_FACTOR_MESSAGE);
    }
  }

  /** Email a `security-notice`. Un-awaited: MailService never throws, and mail must not slow
   *  or fail the change it reports. */
  notify(user: { email: string; name: string }, event: string): void {
    void this.mail.sendSecurityNotice(user.email, user.name, event);
  }

  private async replaceRecoveryCodes(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashToken(normalizeRecoveryCode(code)) })),
    });
    return codes;
  }
}
