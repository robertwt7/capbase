import { describe, it, expect, jest } from '@jest/globals';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
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
};

const me: UserRow = {
  id: 'u1',
  email: 'me@example.com',
  name: 'Me',
  role: 'USER',
  passwordHash: '',
};

const jwt = { sign: jest.fn(() => 'token') } as unknown as JwtService;

function usersWith(overrides: { byEmail?: UserRow | null; byId?: UserRow | null }) {
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
  };
  const mail = { sendWelcomeEmail: jest.fn(async () => undefined) };
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
    expect(users.update).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    const { users, service } = usersWith({ byId: null });
    await expect(
      service.changePassword('u1', { currentPassword: 'x', newPassword: 'battery-staple' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('stores a bcrypt hash of the new password, never the plaintext', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const { users, service } = usersWith({ byId: { ...me, passwordHash } });
    await service.changePassword('u1', {
      currentPassword: 'correct-horse',
      newPassword: 'battery-staple',
    });
    expect(users.update).toHaveBeenCalledTimes(1);
    const [id, data] = users.update.mock.calls[0]!;
    expect(id).toBe('u1');
    expect(data.passwordHash).toBeDefined();
    expect(data.passwordHash).not.toBe('battery-staple');
    await expect(bcrypt.compare('battery-staple', data.passwordHash!)).resolves.toBe(true);
  });
});
