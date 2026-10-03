import { afterEach, describe, it, expect, jest } from '@jest/globals';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { TurnstileGuard } from './turnstile.guard';

function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

const guardWith = (secret?: string) =>
  new TurnstileGuard({ get: () => secret } as unknown as ConfigService);

function mockSiteverify(body: unknown) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

describe('TurnstileGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is a no-op when TURNSTILE_SECRET is unset', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(guardWith(undefined).canActivate(contextWith({}))).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a missing token without calling Cloudflare', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(guardWith('s3cret').canActivate(contextWith({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a token siteverify confirms', async () => {
    const fetchSpy = mockSiteverify({ success: true });
    await expect(
      guardWith('s3cret').canActivate(contextWith({ 'x-turnstile-token': 'tok' })),
    ).resolves.toBe(true);
    const body = (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as URLSearchParams;
    expect(body.get('secret')).toBe('s3cret');
    expect(body.get('response')).toBe('tok');
  });

  it('rejects a token siteverify refuses', async () => {
    mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    await expect(
      guardWith('s3cret').canActivate(contextWith({ 'x-turnstile-token': 'tok' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed when Cloudflare is unreachable', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      guardWith('s3cret').canActivate(contextWith({ 'x-turnstile-token': 'tok' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
