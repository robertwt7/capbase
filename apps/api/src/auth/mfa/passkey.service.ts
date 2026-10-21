import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { MAX_PASSKEYS, type PasskeyOptions, type Role, type WebAuthnOptionsJSON } from '@repo/api';
import type { AuthChallenge, WebAuthnCredential } from '@repo/db';

import { PrismaService } from '../../prisma/prisma.service';
import { MfaService, SecurityEvent } from './mfa.service';

export const PASSKEY_FAILED_MESSAGE = "That passkey couldn't be verified.";

const TRANSPORTS: readonly AuthenticatorTransportFuture[] = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
];
const asTransports = (values: readonly string[] | undefined): AuthenticatorTransportFuture[] =>
  (values ?? []).filter((t): t is AuthenticatorTransportFuture =>
    (TRANSPORTS as readonly string[]).includes(t),
  );

/**
 * Passkeys (WebAuthn) through @simplewebauthn/server: registering one, using one as the second
 * factor after a password, and passwordless sign-in. The relying party is SITE_URL's host
 * (WEBAUTHN_RP_ID overrides) and the only accepted origin is SITE_URL's — the browser talks to
 * the web origin, never the API. Each ceremony's challenge rides on an AuthChallenge row, so it
 * is single-use and expires with the step.
 */
@Injectable()
export class PasskeyService {
  private readonly rpID: string;
  private readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    config: ConfigService,
  ) {
    const site = new URL(config.get<string>('SITE_URL', 'http://localhost:3001'));
    this.origin = site.origin;
    this.rpID = config.get<string>('WEBAUTHN_RP_ID') || site.hostname;
  }

  // --- Registration ---------------------------------------------------------------

  /** Options to create a discoverable passkey (needed for passwordless), on a fresh challenge. */
  async registrationOptions(user: { id: string; email: string; name: string }): Promise<PasskeyOptions> {
    const existing = await this.prisma.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });
    if (existing.length >= MAX_PASSKEYS) {
      throw new BadRequestException(`You can register up to ${MAX_PASSKEYS} passkeys.`);
    }
    const options = await generateRegistrationOptions({
      rpName: 'Capbase',
      rpID: this.rpID,
      userName: user.email,
      userDisplayName: user.name,
      userID: new Uint8Array(Buffer.from(user.id, 'utf8')),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: asTransports(c.transports),
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const challenge = await this.mfa.createChallenge('PASSKEY_REGISTER', user.id, {
      webauthnChallenge: options.challenge,
    });
    return { challenge, options: options as unknown as WebAuthnOptionsJSON };
  }

  /**
   * Verify a registration and store the passkey. The first factor turns 2FA on; returns fresh
   * recovery codes when the account had none unused (else []).
   */
  async register(
    userId: string,
    token: string,
    response: Record<string, unknown>,
    name: string,
  ): Promise<string[]> {
    const challenge = await this.mfa.loadChallenge(token, 'PASSKEY_REGISTER');
    if (challenge.userId !== userId || !challenge.webauthnChallenge) {
      throw new UnauthorizedException('This request has expired. Start again.');
    }
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.webauthnChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: false,
      });
    } catch {
      verification = { verified: false };
    }
    if (!verification.verified) {
      await this.mfa.recordFailure(challenge);
      throw new BadRequestException("That passkey couldn't be registered. Try again.");
    }
    const info = verification.registrationInfo;
    const credentialId = info.credential.id;
    if (await this.prisma.webAuthnCredential.findUnique({ where: { credentialId } })) {
      throw new ConflictException('That passkey is already registered.');
    }

    const { user, codes } = await this.prisma.$transaction(async (tx) => {
      await this.mfa.consumeChallenge(challenge.id, tx);
      if ((await tx.webAuthnCredential.count({ where: { userId } })) >= MAX_PASSKEYS) {
        throw new BadRequestException(`You can register up to ${MAX_PASSKEYS} passkeys.`);
      }
      await tx.webAuthnCredential.create({
        data: {
          userId,
          credentialId,
          publicKey: new Uint8Array(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: asTransports(
            info.credential.transports ??
              ((response.response as { transports?: string[] } | undefined)?.transports ?? []),
          ),
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          name,
        },
      });
      return this.mfa.factorAdded(tx, userId);
    });
    this.mfa.notify(user, SecurityEvent.passkeyAdded(name));
    return codes;
  }

  // --- Second factor after a password -------------------------------------------------

  /** Assertion options for a LOGIN_MFA challenge, limited to that user's passkeys. */
  async secondFactorOptions(token: string): Promise<WebAuthnOptionsJSON> {
    const challenge = await this.mfa.loadChallenge(token, 'LOGIN_MFA');
    const credentials = await this.prisma.webAuthnCredential.findMany({
      where: { userId: challenge.userId ?? '' },
      select: { credentialId: true, transports: true },
    });
    if (credentials.length === 0) throw new BadRequestException('This account has no passkeys.');
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        transports: asTransports(c.transports),
      })),
      userVerification: 'preferred',
    });
    await this.mfa.attachWebauthnChallenge(challenge.id, options.challenge);
    return options as unknown as WebAuthnOptionsJSON;
  }

  /** Whether `response` is a valid assertion, by one of the challenge user's passkeys, for the
   *  WebAuthn challenge issued on this LOGIN_MFA step. The caller counts a failure. */
  async verifySecondFactor(
    challenge: AuthChallenge,
    response: Record<string, unknown> | undefined,
  ): Promise<boolean> {
    if (!challenge.webauthnChallenge || !challenge.userId || typeof response?.id !== 'string') {
      return false;
    }
    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!credential || credential.userId !== challenge.userId) return false;
    return this.verifyAssertion(credential, challenge.webauthnChallenge, response, false);
  }

  // --- Passwordless sign-in ---------------------------------------------------------

  /** Options for a discoverable-credential sign-in: no user yet, user verification required. */
  async passwordlessOptions(): Promise<PasskeyOptions> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: [],
      userVerification: 'required',
    });
    const challenge = await this.mfa.createChallenge('PASSKEY_LOGIN', null, {
      webauthnChallenge: options.challenge,
    });
    return { challenge, options: options as unknown as WebAuthnOptionsJSON };
  }

  /**
   * The user a passwordless assertion proves. User verification on a passkey is already two
   * factors, so this skips the LOGIN_MFA step. Every failure is the same generic 401 — never
   * whether the credential exists. The caller re-checks the ban.
   */
  async passwordlessLogin(token: string, response: Record<string, unknown>): Promise<string> {
    const challenge = await this.mfa.loadChallenge(token, 'PASSKEY_LOGIN').catch(() => {
      throw new UnauthorizedException(PASSKEY_FAILED_MESSAGE);
    });
    const credential =
      typeof response.id === 'string'
        ? await this.prisma.webAuthnCredential.findUnique({ where: { credentialId: response.id } })
        : null;
    if (
      !credential ||
      !challenge.webauthnChallenge ||
      !(await this.verifyAssertion(credential, challenge.webauthnChallenge, response, true))
    ) {
      await this.mfa.recordFailure(challenge);
      throw new UnauthorizedException(PASSKEY_FAILED_MESSAGE);
    }
    await this.mfa.consumeChallenge(challenge.id).catch(() => {
      throw new UnauthorizedException(PASSKEY_FAILED_MESSAGE);
    });
    return credential.userId;
  }

  // --- Removal --------------------------------------------------------------------

  /** Remove one of the user's passkeys. Refused when it is a required role's last factor. */
  async remove(user: { id: string; role: Role; totpEnabledAt: Date | null }, id: string): Promise<void> {
    const credential = await this.prisma.webAuthnCredential.findFirst({
      where: { id, userId: user.id },
    });
    if (!credential) throw new NotFoundException('Passkey not found');
    const others = await this.prisma.webAuthnCredential.count({
      where: { userId: user.id, id: { not: id } },
    });
    this.mfa.assertNotLastFactor(user, others === 0 && !user.totpEnabledAt);
    const owner = await this.prisma.$transaction(async (tx) => {
      await tx.webAuthnCredential.delete({ where: { id } });
      await this.mfa.factorRemoved(tx, user.id);
      return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true, name: true } });
    });
    this.mfa.notify(owner, SecurityEvent.passkeyRemoved(credential.name));
  }

  /**
   * Verify an assertion against a stored passkey and record its use. A counter that fails to
   * advance (when either side is non-zero) means a cloned authenticator: rejected. Many synced
   * passkeys always report 0, which is fine.
   */
  private async verifyAssertion(
    credential: WebAuthnCredential,
    expectedChallenge: string,
    response: Record<string, unknown>,
    requireUserVerification: boolean,
  ): Promise<boolean> {
    const stored = Number(credential.counter);
    let info: Awaited<ReturnType<typeof verifyAuthenticationResponse>>['authenticationInfo'];
    try {
      const result = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: stored,
          transports: asTransports(credential.transports),
        },
        requireUserVerification,
      });
      if (!result.verified) return false;
      info = result.authenticationInfo;
    } catch {
      return false;
    }
    if (requireUserVerification && !info.userVerified) return false;
    if ((info.newCounter > 0 || stored > 0) && info.newCounter <= stored) return false;
    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: { counter: BigInt(info.newCounter), lastUsedAt: new Date() },
    });
    return true;
  }
}
