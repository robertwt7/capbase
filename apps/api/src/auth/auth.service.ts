import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
};

const RESET_TTL_MS = 60 * 60 * 1000;
/** One reset email per account per minute, whatever the per-IP limit allows. */
const RESET_COOLDOWN_MS = 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
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
    void this.mail.sendWelcomeEmail(user.email, user.name); // fire-and-forget; never throws
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

  /** Update the signed-in user's name/email. Email stays unique. */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthUser> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email already registered');
    }
    const user = await this.users.update(userId, { name: dto.name, email: dto.email });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
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

  private buildResponse(user: UserRecord): AuthResponse {
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion,
    };
    const accessToken = this.jwt.sign(payload);
    return { accessToken, user: authUser };
  }
}
