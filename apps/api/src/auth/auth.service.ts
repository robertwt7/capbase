import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { AuthResponse, AuthUser } from '@repo/api';

import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { JwtPayload } from './jwt.strategy';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  passwordHash: string;
  tokenVersion: number;
  bannedAt: Date | null;
  emailVerifiedAt: Date | null;
};

const RESET_TTL_MS = 60 * 60 * 1000;
/** One reset email per account per minute, whatever the per-IP limit allows. */
const RESET_COOLDOWN_MS = 60 * 1000;

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** One verification email per account per minute. nginx's per-IP zones don't cover this:
 *  the resend button is a server action, which lands in the `writes` zone. */
const VERIFY_COOLDOWN_MS = 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The client-facing view of a user row. */
export const toAuthUser = (
  user: Pick<UserRecord, 'id' | 'email' | 'name' | 'role' | 'emailVerifiedAt'>,
): AuthUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  emailVerified: user.emailVerifiedAt !== null,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto, siteUrl: string): Promise<AuthResponse> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
      role: 'USER',
    });
    // The welcome email waits until the address is confirmed (verifyEmail).
    await this.issueVerification(user, siteUrl);
    return this.buildResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.users.findByEmail(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Checked after the password, so a guesser can't probe which accounts are banned.
    if (user.bannedAt) {
      throw new ForbiddenException('This account has been suspended');
    }
    return this.buildResponse(user);
  }

  /**
   * Update the signed-in user's name/email. Email stays unique. A new address
   * has to be confirmed again before the account can contribute, so changing it
   * clears verification and mails a link to the new address.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto, siteUrl: string): Promise<AuthUser> {
    const current = await this.users.findById(userId);
    if (!current) throw new UnauthorizedException();
    const existing = await this.users.findByEmail(dto.email);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email already registered');
    }
    // Compared exactly, the same way the unique index compares.
    const emailChanged = dto.email !== current.email;
    const user = await this.users.update(userId, {
      name: dto.name,
      email: dto.email,
      ...(emailChanged && { emailVerifiedAt: null }),
    });
    if (emailChanged) await this.issueVerification(user, siteUrl);
    return toAuthUser(user);
  }

  /** Spend a verification link. The first successful one also sends the welcome email. */
  async verifyEmail(token: string): Promise<void> {
    const result = await this.users.consumeVerificationToken(hashToken(token));
    if (!result) {
      throw new BadRequestException('This verification link is invalid, expired, or already used');
    }
    if (result.newlyVerified) {
      void this.mail.sendWelcomeEmail(result.email, result.name); // never throws
    }
  }

  /**
   * Mail a fresh verification link to the signed-in user. Unlike forgot-password
   * this is authenticated, so saying "too soon" leaks nothing.
   */
  async resendVerification(userId: string, siteUrl: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (user.emailVerifiedAt) return;
    const last = await this.users.lastVerificationRequestAt(user.id);
    if (last && Date.now() - last.getTime() < VERIFY_COOLDOWN_MS) {
      throw new HttpException(
        'We sent a link less than a minute ago. Check your inbox and spam folder.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.issueVerification(user, siteUrl);
  }

  /**
   * Change password after verifying the current one. Revokes every other
   * session, so it returns a fresh token for the caller's own.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<AuthResponse> {
    const user = await this.users.findById(userId);
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    return this.buildResponse(await this.users.setPassword(userId, passwordHash));
  }

  /**
   * Email a single-use reset link. Silent on unknown or banned accounts so the
   * endpoint can't be used to discover who is registered.
   */
  async requestPasswordReset(email: string, siteUrl: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.bannedAt) return;
    const last = await this.users.lastResetRequestAt(user.id);
    if (last && Date.now() - last.getTime() < RESET_COOLDOWN_MS) return;

    const token = randomBytes(32).toString('base64url');
    await this.users.createResetToken(
      user.id,
      hashToken(token),
      new Date(Date.now() + RESET_TTL_MS),
    );
    const link = `${siteUrl}/reset-password?token=${encodeURIComponent(token)}`;
    void this.mail.sendPasswordResetEmail(user.email, user.name, link); // never throws
  }

  /** Set a new password from a reset link. */
  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await bcrypt.hash(password, 10);
    const ok = await this.users.consumeResetToken(hashToken(token), passwordHash);
    if (!ok) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }
  }

  /** Mint a verification link bound to the user's current address and mail it. */
  private async issueVerification(
    user: { id: string; email: string; name: string },
    siteUrl: string,
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.users.createVerificationToken(
      user.id,
      user.email,
      hashToken(token),
      new Date(Date.now() + VERIFY_TTL_MS),
    );
    const link = `${siteUrl}/verify-email?token=${encodeURIComponent(token)}`;
    void this.mail.sendVerificationEmail(user.email, user.name, link); // never throws
  }

  private buildResponse(user: UserRecord): AuthResponse {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion,
    };
    const accessToken = this.jwt.sign(payload);
    return { accessToken, user: toAuthUser(user) };
  }
}
