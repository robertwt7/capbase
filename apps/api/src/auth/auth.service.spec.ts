import { describe, it, expect, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
};

const me: UserRow = {
  id: 'u1',
  email: 'me@example.com',
  name: 'Me',
  role: 'USER',
  passwordHash: '',
  tokenVersion: 0,
  bannedAt: null,
};

const jwt = { sign: jest.fn(() => 'token') } as unknown as JwtService;

function usersWith(overrides: {
  byEmail?: UserRow | null;
  byId?: UserRow | null;
  lastResetAt?: Date | null;
  consumed?: boolean;
}) {
  const users = {
    findByEmail: jest.fn(async () => overrides.byEmail ?? null),
    findById: jest.fn(async () => overrides.byId ?? null),
    create: jest.fn(
      async (data: {
        email: string;
        name: string;
        passwordHash: string;
        role: 'USER' | 'ADMIN';
      }) => ({ ...me, email: data.email, name: data.name, role: data.role }),
    ),
    update: jest.fn(
      async (id: string, data: { name?: string; email?: string; passwordHash?: string }) => ({
        ...me,
        id,
        ...data,
      }),
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
  };
  const mail = {
    sendWelcomeEmail: jest.fn(async () => undefined),
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

describe('AuthService.register', () => {
  it('sends a welcome email to the new user on success', async () => {
    const { mail, service } = usersWith({ byEmail: null });
    await service.register({ name: 'New', email: 'new@example.com', password: 'battery-staple' });
    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith('new@example.com', 'New');
  });

  it('does not send a welcome email when the email is already registered', async () => {
    const { mail, service } = usersWith({ byEmail: me });
    await expect(
      service.register({ name: 'Dup', email: 'me@example.com', password: 'battery-staple' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe('AuthService.updateProfile', () => {
  it('rejects an email owned by another user', async () => {
    const { users, service } = usersWith({ byEmail: { ...me, id: 'other' } });
    await expect(
      service.updateProfile('u1', { name: 'New', email: 'me@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('allows keeping your own email', async () => {
    const { service } = usersWith({ byEmail: me });
    await expect(
      service.updateProfile('u1', { name: 'Renamed', email: 'me@example.com' }),
    ).resolves.toEqual({ id: 'u1', email: 'me@example.com', name: 'Renamed', role: 'USER' });
  });

  it('updates to a fresh email and returns the mapped AuthUser (no passwordHash)', async () => {
    const { users, service } = usersWith({ byEmail: null });
    const result = await service.updateProfile('u1', { name: 'New', email: 'new@example.com' });
    expect(users.update).toHaveBeenCalledWith('u1', { name: 'New', email: 'new@example.com' });
    expect(result).toEqual({ id: 'u1', email: 'new@example.com', name: 'New', role: 'USER' });
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
