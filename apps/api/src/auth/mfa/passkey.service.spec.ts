import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_PASSKEYS } from '@repo/api';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(async () => ({ challenge: 'reg-challenge' })),
  generateAuthenticationOptions: jest.fn(async () => ({ challenge: 'auth-challenge' })),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import * as webauthn from '@simplewebauthn/server';

import type { PrismaService } from '../../prisma/prisma.service';
import type { MfaService } from './mfa.service';
import { PASSKEY_FAILED_MESSAGE, PasskeyService } from './passkey.service';

const verifyReg = webauthn.verifyRegistrationResponse as unknown as jest.Mock<(...a: unknown[]) => Promise<unknown>>;
const verifyAuth = webauthn.verifyAuthenticationResponse as unknown as jest.Mock<(...a: unknown[]) => Promise<unknown>>;
const genAuth = webauthn.generateAuthenticationOptions as unknown as jest.Mock<(...a: unknown[]) => Promise<unknown>>;

type Challenge = {
  id: string;
  purpose: string;
  userId: string | null;
  webauthnChallenge: string | null;
};

const credentialRow = (over: Record<string, unknown> = {}) => ({
  id: 'pk1',
  userId: 'u1',
  credentialId: 'cred-1',
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 5n,
  transports: ['internal', 'bogus'],
  deviceType: 'multiDevice',
  backedUp: true,
  name: 'Laptop',
  createdAt: new Date(),
  lastUsedAt: null,
  ...over,
});

function setup(opts: { challenge?: Challenge; credentials?: ReturnType<typeof credentialRow>[] } = {}) {
  const credentials = opts.credentials ?? [credentialRow()];
  const challenge: Challenge = opts.challenge ?? {
    id: 'ch1',
    purpose: 'LOGIN_MFA',
    userId: 'u1',
    webauthnChallenge: 'issued-challenge',
  };
  const tx = {
    webAuthnCredential: {
      count: jest.fn(async () => credentials.length),
      create: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    },
    user: { findUniqueOrThrow: jest.fn(async () => ({ email: 'ada@example.com', name: 'Ada' })) },
  };
  const prisma = {
    webAuthnCredential: {
      findMany: jest.fn(async () => credentials),
      findUnique: jest.fn(async ({ where }: { where: { credentialId: string } }) =>
        credentials.find((c) => c.credentialId === where.credentialId) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string } }) =>
        credentials.find((c) => c.id === where.id && c.userId === where.userId) ?? null,
      ),
      count: jest.fn(async ({ where }: { where: { id: { not: string } } }) =>
        credentials.filter((c) => c.id !== where.id.not).length,
      ),
      update: jest.fn(async () => undefined),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const mfa = {
    createChallenge: jest.fn(async () => 't'.repeat(43)),
    loadChallenge: jest.fn(async (_token: string, purpose: string) => {
      if (purpose !== challenge.purpose) throw new UnauthorizedException('This sign-in has expired. Start again.');
      return challenge;
    }),
    consumeChallenge: jest.fn(async () => undefined),
    attachWebauthnChallenge: jest.fn(async () => undefined),
    recordFailure: jest.fn(async () => undefined),
    factorAdded: jest.fn(async () => ({ user: { email: 'ada@example.com', name: 'Ada' }, codes: ['c1'] })),
    factorRemoved: jest.fn(async () => undefined),
    assertNotLastFactor: jest.fn((_user: unknown, isLast: boolean) => {
      if (isLast) throw new BadRequestException('last factor');
    }),
    notify: jest.fn(),
  };
  const service = new PasskeyService(
    prisma as unknown as PrismaService,
    mfa as unknown as MfaService,
    new ConfigService({ SITE_URL: 'https://capbase.fyi' }),
  );
  return { prisma, tx, mfa, service, challenge };
}

const assertion = (id = 'cred-1') => ({ id, rawId: id, type: 'public-key', response: {} });

beforeEach(() => {
  verifyReg.mockReset();
  verifyAuth.mockReset();
  genAuth.mockClear();
});

describe('PasskeyService.verifySecondFactor', () => {
  it('verifies against the challenge stored on the step, with the site origin and rp id', async () => {
    const { service, challenge, prisma } = setup();
    verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6, userVerified: false } });
    await expect(service.verifySecondFactor(challenge as never, assertion())).resolves.toBe(true);
    expect(verifyAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'issued-challenge',
        expectedOrigin: 'https://capbase.fyi',
        expectedRPID: 'capbase.fyi',
        requireUserVerification: false,
        credential: expect.objectContaining({ id: 'cred-1', counter: 5, transports: ['internal'] }),
      }),
    );
    expect(prisma.webAuthnCredential.update).toHaveBeenCalledWith({
      where: { id: 'pk1' },
      data: { counter: 6n, lastUsedAt: expect.any(Date) },
    });
  });

  it('rejects a counter that did not advance (a cloned authenticator)', async () => {
    const { service, challenge, prisma } = setup();
    verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 5, userVerified: true } });
    await expect(service.verifySecondFactor(challenge as never, assertion())).resolves.toBe(false);
    expect(prisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('accepts a passkey that always reports 0', async () => {
    const { service, challenge } = setup({ credentials: [credentialRow({ counter: 0n })] });
    verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0, userVerified: true } });
    await expect(service.verifySecondFactor(challenge as never, assertion())).resolves.toBe(true);
  });

  it("refuses another user's passkey, an unknown one, or a step with no options issued", async () => {
    const { service, challenge } = setup({ credentials: [credentialRow({ userId: 'u2' })] });
    await expect(service.verifySecondFactor(challenge as never, assertion())).resolves.toBe(false);
    await expect(service.verifySecondFactor(challenge as never, assertion('nope'))).resolves.toBe(false);
    await expect(
      service.verifySecondFactor({ ...challenge, webauthnChallenge: null } as never, assertion()),
    ).resolves.toBe(false);
    expect(verifyAuth).not.toHaveBeenCalled();
  });

  it('treats a library error (bad signature, wrong challenge) as a plain failure', async () => {
    const { service, challenge } = setup();
    verifyAuth.mockRejectedValue(new Error('Unexpected authentication response challenge'));
    await expect(service.verifySecondFactor(challenge as never, assertion())).resolves.toBe(false);
  });
});

describe('PasskeyService.secondFactorOptions', () => {
  it("limits options to the user's passkeys and stores the issued challenge on the step", async () => {
    const { service, mfa } = setup();
    await service.secondFactorOptions('t'.repeat(43));
    expect(genAuth).toHaveBeenCalledWith(
      expect.objectContaining({ allowCredentials: [{ id: 'cred-1', transports: ['internal'] }] }),
    );
    expect(mfa.attachWebauthnChallenge).toHaveBeenCalledWith('ch1', 'auth-challenge');
  });
});

describe('PasskeyService passwordless', () => {
  const loginChallenge: Challenge = {
    id: 'ch2',
    purpose: 'PASSKEY_LOGIN',
    userId: null,
    webauthnChallenge: 'pl-challenge',
  };

  it('issues options with user verification required and no allow-list', async () => {
    const { service, mfa } = setup({ challenge: loginChallenge });
    await service.passwordlessOptions();
    expect(genAuth).toHaveBeenCalledWith(
      expect.objectContaining({ allowCredentials: [], userVerification: 'required' }),
    );
    expect(mfa.createChallenge).toHaveBeenCalledWith('PASSKEY_LOGIN', null, {
      webauthnChallenge: 'auth-challenge',
    });
  });

  it('returns the owner of a verified credential and spends the challenge', async () => {
    const { service, mfa } = setup({ challenge: loginChallenge });
    verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 9, userVerified: true } });
    await expect(service.passwordlessLogin('t'.repeat(43), assertion())).resolves.toBe('u1');
    expect(verifyAuth).toHaveBeenCalledWith(
      expect.objectContaining({ expectedChallenge: 'pl-challenge', requireUserVerification: true }),
    );
    expect(mfa.consumeChallenge).toHaveBeenCalledWith('ch2');
  });

  it('requires user verification', async () => {
    const { service } = setup({ challenge: loginChallenge });
    verifyAuth.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 9, userVerified: false } });
    await expect(service.passwordlessLogin('t'.repeat(43), assertion())).rejects.toThrow(PASSKEY_FAILED_MESSAGE);
  });

  it('gives the same generic 401 for an unknown credential or a dead challenge', async () => {
    const { service, mfa } = setup({ challenge: loginChallenge });
    const unknown = await service.passwordlessLogin('t'.repeat(43), assertion('nope')).catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect((unknown as Error).message).toBe(PASSKEY_FAILED_MESSAGE);
    expect(mfa.recordFailure).toHaveBeenCalled();

    const { service: other } = setup(); // its challenge is LOGIN_MFA, so PASSKEY_LOGIN fails to load
    const dead = await other.passwordlessLogin('t'.repeat(43), assertion()).catch((e: unknown) => e);
    expect((dead as Error).message).toBe(PASSKEY_FAILED_MESSAGE);
  });
});

describe('PasskeyService.register', () => {
  const regChallenge: Challenge = {
    id: 'ch3',
    purpose: 'PASSKEY_REGISTER',
    userId: 'u1',
    webauthnChallenge: 'reg-challenge',
  };
  const verified = (id: string) => ({
    verified: true,
    registrationInfo: {
      credential: { id, publicKey: new Uint8Array([9]), counter: 0, transports: ['hybrid', 'internal'] },
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
    },
  });

  it('stores a verified passkey, spends the challenge and turns 2FA on', async () => {
    const { service, tx, mfa } = setup({ challenge: regChallenge });
    verifyReg.mockResolvedValue(verified('new-cred'));
    await expect(service.register('u1', 't'.repeat(43), { id: 'new-cred' }, 'Phone')).resolves.toEqual(['c1']);
    expect(verifyReg).toHaveBeenCalledWith(
      expect.objectContaining({ expectedChallenge: 'reg-challenge', expectedOrigin: 'https://capbase.fyi' }),
    );
    expect(mfa.consumeChallenge).toHaveBeenCalledWith('ch3', tx);
    expect(tx.webAuthnCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        credentialId: 'new-cred',
        deviceType: 'singleDevice',
        transports: ['hybrid', 'internal'],
        name: 'Phone',
      }),
    });
    expect(mfa.factorAdded).toHaveBeenCalledWith(tx, 'u1');
    expect(mfa.notify).toHaveBeenCalled();
  });

  it("refuses another user's registration challenge", async () => {
    const { service } = setup({ challenge: regChallenge });
    await expect(service.register('u2', 't'.repeat(43), {}, 'Phone')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifyReg).not.toHaveBeenCalled();
  });

  it('counts a failed verification and stores nothing', async () => {
    const { service, tx, mfa } = setup({ challenge: regChallenge });
    verifyReg.mockResolvedValue({ verified: false });
    await expect(service.register('u1', 't'.repeat(43), {}, 'Phone')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mfa.recordFailure).toHaveBeenCalled();
    expect(tx.webAuthnCredential.create).not.toHaveBeenCalled();
  });

  it('answers 409 for a passkey that is already registered', async () => {
    const { service } = setup({ challenge: regChallenge });
    verifyReg.mockResolvedValue(verified('cred-1'));
    await expect(service.register('u1', 't'.repeat(43), {}, 'Phone')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses options past MAX_PASSKEYS', async () => {
    const many = Array.from({ length: MAX_PASSKEYS }, (_, i) =>
      credentialRow({ id: `pk${i}`, credentialId: `c${i}` }),
    );
    const { service } = setup({ credentials: many });
    await expect(
      service.registrationOptions({ id: 'u1', email: 'ada@example.com', name: 'Ada' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PasskeyService.remove', () => {
  it('applies the last-factor rule', async () => {
    const { service, tx } = setup();
    await expect(
      service.remove({ id: 'u1', role: 'CONTRIBUTOR', totpEnabledAt: null }, 'pk1'),
    ).rejects.toThrow('last factor');
    expect(tx.webAuthnCredential.delete).not.toHaveBeenCalled();
  });

  it('removes a passkey when an authenticator app remains', async () => {
    const { service, tx, mfa } = setup();
    await service.remove({ id: 'u1', role: 'CONTRIBUTOR', totpEnabledAt: new Date() }, 'pk1');
    expect(tx.webAuthnCredential.delete).toHaveBeenCalledWith({ where: { id: 'pk1' } });
    expect(mfa.factorRemoved).toHaveBeenCalledWith(tx, 'u1');
  });
});
