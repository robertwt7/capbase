import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AuthResponse,
  AuthUser,
  MyContributionsResponse,
  SavedCompanyItem,
  SavedStatus,
} from '@repo/api';

import { UsersService } from '../users/users.service';
import { AuthService, toAuthUser } from './auth.service';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TurnstileGuard } from './guards/turnstile.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  /** Where emailed links point: the public web origin. */
  private siteUrl(): string {
    return this.config.get<string>('SITE_URL', 'http://localhost:3001');
  }

  @UseGuards(TurnstileGuard)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto, this.siteUrl());
  }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  /** Always 200, whether or not the email is registered. */
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.auth.requestPasswordReset(dto.email, this.siteUrl());
    return { ok: true };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  /** Public: the token is the credential, and the link may be opened on another device. */
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ ok: true }> {
    await this.auth.verifyEmail(dto.token);
    return { ok: true };
  }

  /** 429 within a minute of the last link; a no-op once verified. */
  @UseGuards(JwtAuthGuard)
  @Post('resend-verification')
  @HttpCode(200)
  async resendVerification(@CurrentUser() current: RequestUser): Promise<{ ok: true }> {
    await this.auth.resendVerification(current.id, this.siteUrl());
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() current: RequestUser): Promise<AuthUser> {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException('User not found');
    return toAuthUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(
    @CurrentUser() current: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    return this.auth.updateProfile(current.id, dto, this.siteUrl());
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/password')
  /** Revokes every session; the response carries a fresh token for this one. */
  changePassword(
    @CurrentUser() current: RequestUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthResponse> {
    return this.auth.changePassword(current.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/contributions')
  async myContributions(@CurrentUser() current: RequestUser): Promise<MyContributionsResponse> {
    const [items, access] = await Promise.all([
      this.users.listContributions(current.id),
      this.users.accessFor(current),
    ]);
    return { access, items };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/saved-companies')
  savedCompanies(@CurrentUser() current: RequestUser): Promise<SavedCompanyItem[]> {
    return this.users.listSavedCompanies(current.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/saved-companies/:slug')
  async savedStatus(
    @CurrentUser() current: RequestUser,
    @Param('slug') slug: string,
  ): Promise<SavedStatus> {
    return { saved: await this.users.isCompanySaved(current.id, slug) };
  }

  @UseGuards(JwtAuthGuard)
  @Put('me/saved-companies/:slug')
  saveCompany(
    @CurrentUser() current: RequestUser,
    @Param('slug') slug: string,
  ): Promise<SavedStatus> {
    return this.users.saveCompany(current.id, slug);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/saved-companies/:slug')
  unsaveCompany(
    @CurrentUser() current: RequestUser,
    @Param('slug') slug: string,
  ): Promise<SavedStatus> {
    return this.users.unsaveCompany(current.id, slug);
  }
}
