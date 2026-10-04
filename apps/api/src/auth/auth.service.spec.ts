import { describe, it, expect, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  passwordHash: string;
  tokenVersion: number;
  bannedAt: Date | null;
  emailVerifiedAt: Date | null;
};

const me: UserRow = {
  id: 'u1',
  email: 'me@example.com',
  name: 'Me',
  role: 'USER',
  passwordHash: '',
  tokenVersion: 0,
  bannedAt: null,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
};

type Consumed = { email: string; name: string; newlyVerified: boolean } | null;

const jwt = { sign: jest.fn(() => 'token') } as unknown as JwtService;

function usersWith(overrides: {
  byEmail?: UserRow | null;
  byId?: UserRow | null;
  lastResetAt?: Date | null;
  consumed?: boolean;
  lastVerificationAt?: Date | null;
  verified?: Consumed;
}) {
  const users = {
    findByEmail: jest.fn(async () => overrides.byEmail ?? null),
    // Defaults to the signed-in user; pass `byId: null` for a deleted account.
    findById: jest.fn(async () => ('byId' in overrides ? overrides.byId : me)),
    create: jest.fn(
      async (data: {
        email: string;
        name: string;
        passwordHash: string;
        role: 'USER' | 'ADMIN';
      }) => ({
        ...me,
        email: data.email,
        name: data.name,
        role: data.role,
        emailVerifiedAt: null,
      }),
    ),
    update: jest.fn(
      async (
        id: string,
        data: {
          name?: string;
          email?: string;
          passwordHash?: string;
          emailVerifiedAt?: Date | null;
        },
      ) => ({ ...me, id, ...data }),
    ),
    setPassword: jest.fn(async (id: string, passwordHash: string) => ({
      ...me,
      id,
      passwordHash,
      tokenVersion: me.tokenVersion + 1,
    })),
    lastResetRequestAt: jest.fn(async () => overrides.lastResetAt ?? null),
    createResetToken: jest.fn<
      (userId: string, tokenHash: string, expiresAt: Date) => Promise<void>
    >(async () => undefined),
    consumeResetToken: jest.fn<(tokenHash: string, passwordHash: string) => Promise<boolean>>(
      async () => overrides.consumed ?? true,
    ),
    lastVerificationRequestAt: jest.fn(async () => overrides.lastVerificationAt ?? null),
    createVerificationToken: jest.fn<
      (userId: string, email: string, tokenHash: string, expiresAt: Date) => Promise<void>
    >(async () => undefined),
    consumeVerificationToken: jest.fn<(tokenHash: string) => Promise<Consumed>>(async () =>
      'verified' in overrides
        ? (overrides.verified ?? null)
        : { email: me.email, name: me.name, newlyVerified: true },
    ),
  };
  const mail = {
    sendWelcomeEmail: jest.fn<(to: string, name: string) => Promise<void>>(async () => undefined),
    sendVerificationEmail: jest.fn<(to: string, name: string, link: string) => Promise<void>>(
      async () => undefined,
    ),
    sendPasswordResetEmail: jest.fn<(to: string, name: string, link: string) => Promise<void>>(
      async () => undefined,
    ),
  };
  return {
    users,
    mail,
    service: new AuthService(
      users as unknown as UsersService,
      jwt,
      mail as unknown as MailService,
    ),
  };
}

const SITE = 'https://capbase.fyi';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('AuthService.register', () => {
  it('issues a hashed, 24h verification token bound to the new address', async () => {
    const { users, service } = usersWith({ byEmail: null });
    const before = Date.now();
    await service.register(
      { name: 'New', email: 'new@example.com', password: 'battery-staple' },
      SITE,
    );
    expect(users.createVerificationToken).toHaveBeenCalledTimes(1);
    const [userId, email, tokenHash, expiresAt] = users.createVerificationToken.mock.calls[0]!;
    expect(userId).toBe('u1');
    expect(email).toBe('new@example.com');
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + DAY_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + DAY_MS);
  });

  it('emails the raw token as a /verify-email link and sends no welcome yet', async () => {
    const { users, mail, service } = usersWith({ byEmail: null });
    const res = await service.register(
      { name: 'New', email: 'new@example.com', password: 'battery-staple' },
      SITE,
    );
    const [to, name, link] = mail.sendVerificationEmail.mock.calls[0]!;
    expect(to).toBe('new@example.com');
    expect(name).toBe('New');
    expect(link.startsWith(`${SITE}/verify-email?token=`)).toBe(true);
    const raw = new URL(link).searchParams.get('token');
    const [, , tokenHash] = users.createVerificationToken.mock.calls[0]!;
    expect(raw).toBeTruthy();
    expect(tokenHash).not.toBe(raw);
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(res.user.emailVerified).toBe(false);
  });

  it('sends nothing when the email is already registered', async () => {
    const { mail, service } = usersWith({ byEmail: me });
    await expect(
      service.register({ name: 'Dup', email: 'me@example.com', password: 'battery-staple' }, SITE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe('AuthService.verifyEmail', () => {
  it('rejects a token the store refuses', async () => {
    const { mail, service } = usersWith({ verified: null });
    await expect(service.verifyEmail('bad')).rejects.toBeInstanceOf(BadRequestException);
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('hands the store a hash, never the raw token', async () => {
    const { users, service } = usersWith({});
    await service.verifyEmail('tok');
    const [tokenHash] = users.consumeVerificationToken.mock.calls[0]!;
    expect(tokenHash).not.toBe('tok');
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends the welcome email when this call verified the account', async () => {
    const { mail, service } = usersWith({
      verified: { email: 'me@example.com', name: 'Me', newlyVerified: true },
    });
    await service.verifyEmail('tok');
    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith('me@example.com', 'Me');
  });

  it('sends no second welcome to an account that was already verified', async () => {
    const { mail, service } = usersWith({
      verified: { email: 'me@example.com', name: 'Me', newlyVerified: false },
    });
    await service.verifyEmail('tok');
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe('AuthService.resendVerification', () => {
  const unverified = { ...me, emailVerifiedAt: null };

  it('does nothing for an account that is already verified', async () => {
    const { users, mail, service } = usersWith({ byId: me });
    await service.resendVerification('u1', SITE);
    expect(users.createVerificationToken).not.toHaveBeenCalled();
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('answers 429 within a minute of the last link', async () => {
    const { mail, service } = usersWith({
      byId: unverified,
      lastVerificationAt: new Date(Date.now() - 10_000),
    });
    const err = await service.resendVerification('u1', SITE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('issues and mails a fresh link otherwise', async () => {
    const { users, mail, service } = usersWith({
      byId: unverified,
      lastVerificationAt: new Date(Date.now() - 120_000),
    });
    await service.resendVerification('u1', SITE);
    expect(users.createVerificationToken).toHaveBeenCalledTimes(1);
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith(
      'me@example.com',
      'Me',
      expect.stringContaining('/verify-email?token='),
    );
  });

  it('rejects a deleted account', async () => {
    const { service } = usersWith({ byId: null });
    await expect(service.resendVerification('u1', SITE)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('AuthService.updateProfile', () => {
  it('rejects an email owned by another user', async () => {
    const { users, service } = usersWith({ byEmail: { ...me, id: 'other' } });
    await expect(
      service.updateProfile('u1', { name: 'New', email: 'me@example.com' }, SITE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('keeps verification and sends no mail on a name-only change', async () => {
    const { users, mail, service } = usersWith({ byEmail: me });
    await expect(
      service.updateProfile('u1', { name: 'Renamed', email: 'me@example.com' }, SITE),
    ).resolves.toEqual({
      id: 'u1',
      email: 'me@example.com',
      name: 'Renamed',
      role: 'USER',
      emailVerified: true,
    });
    expect(users.update).toHaveBeenCalledWith('u1', { name: 'Renamed', email: 'me@example.com' });
    expect(users.createVerificationToken).not.toHaveBeenCalled();
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('clears verification on an email change and mails the new address', async () => {
    const { users, mail, service } = usersWith({ byEmail: null });
    const result = await service.updateProfile(
      'u1',
      { name: 'New', email: 'new@example.com' },
      SITE,
    );
    expect(users.update).toHaveBeenCalledWith('u1', {
      name: 'New',
      email: 'new@example.com',
      emailVerifiedAt: null,
    });
    expect(result).toEqual({
      id: 'u1',
      email: 'new@example.com',
      name: 'New',
      role: 'USER',
      emailVerified: false,
    });
    const [, email] = users.createVerificationToken.mock.calls[0]!;
    expect(email).toBe('new@example.com');
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith(
      'new@example.com',
      'New',
      expect.stringContaining('/verify-email?token='),
    );
  });
});

describe('AuthService.changePassword', () => {
  it('rejects when the current password is wrong', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const { users, service } = usersWith({ byId: { ...me, passwordHash } });
    await expect(
      service.changePassword('u1', { currentPassword: 'wrong', newPassword: 'battery-staple' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.setPassword).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    const { users, service } = usersWith({ byId: null });
    await expect(
      service.changePassword('u1', { currentPassword: 'x', newPassword: 'battery-staple' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.setPassword).not.toHaveBeenCalled();
  });

  it('stores a bcrypt hash of the new password, never the plaintext', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const { users, service } = usersWith({ byId: { ...me, passwordHash } });
    await service.changePassword('u1', {
      currentPassword: 'correct-horse',
      newPassword: 'battery-staple',
    });
    expect(users.setPassword).toHaveBeenCalledTimes(1);
    const [id, hash] = users.setPassword.mock.calls[0]!;
    expect(id).toBe('u1');
    expect(hash).not.toBe('battery-staple');
    await expect(bcrypt.compare('battery-staple', hash)).resolves.toBe(true);
  });

  it('returns a fresh token signed with the bumped tokenVersion', async () => {
    const sign = jwt.sign as unknown as jest.Mock;
    sign.mockClear();
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const { service } = usersWith({ byId: { ...me, passwordHash } });
    const res = await service.changePassword('u1', {
      currentPassword: 'correct-horse',
      newPassword: 'battery-staple',
    });
    expect(res.accessToken).toBe('token');
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u1', tv: 1 }));
  });
});

describe('AuthService.login', () => {
  it('refuses a banned account even with the right password', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const { service } = usersWith({ byEmail: { ...me, passwordHash, bannedAt: new Date() } });
    await expect(
      service.login({ email: 'me@example.com', password: 'correct-horse' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not reveal a ban to a wrong-password guess', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const { service } = usersWith({ byEmail: { ...me, passwordHash, bannedAt: new Date() } });
    await expect(
      service.login({ email: 'me@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.requestPasswordReset', () => {
  it('stores only a hash of the token and emails the raw one', async () => {
    const { users, mail, service } = usersWith({ byEmail: me });
    await service.requestPasswordReset('me@example.com', 'https://capbase.fyi');
    const [userId, tokenHash, expiresAt] = users.createResetToken.mock.calls[0]!;
    expect(userId).toBe('u1');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const [, , link] = mail.sendPasswordResetEmail.mock.calls[0]!;
    expect(link.startsWith('https://capbase.fyi/reset-password?token=')).toBe(true);
    const raw = new URL(link).searchParams.get('token');
    expect(tokenHash).not.toBe(raw);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is silent for an unknown email', async () => {
    const { users, mail, service } = usersWith({ byEmail: null });
    await service.requestPasswordReset('nobody@example.com', 'https://capbase.fyi');
    expect(users.createResetToken).not.toHaveBeenCalled();
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('is silent for a banned account', async () => {
    const { mail, service } = usersWith({ byEmail: { ...me, bannedAt: new Date() } });
    await service.requestPasswordReset('me@example.com', 'https://capbase.fyi');
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('sends at most one email per account per minute', async () => {
    const { mail, service } = usersWith({ byEmail: me, lastResetAt: new Date(Date.now() - 10_000) });
    await service.requestPasswordReset('me@example.com', 'https://capbase.fyi');
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe('AuthService.resetPassword', () => {
  it('rejects a token the store refuses', async () => {
    const { service } = usersWith({ consumed: false });
    await expect(service.resetPassword('bad', 'battery-staple')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('hands the store a bcrypt hash, never the plaintext', async () => {
    const { users, service } = usersWith({ consumed: true });
    await service.resetPassword('tok', 'battery-staple');
    const [tokenHash, hash] = users.consumeResetToken.mock.calls[0]!;
    expect(tokenHash).not.toBe('tok');
    await expect(bcrypt.compare('battery-staple', hash)).resolves.toBe(true);
  });
});
