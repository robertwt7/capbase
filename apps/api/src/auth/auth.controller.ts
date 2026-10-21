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
  ApiKeySummary,
  AuthResponse,
  AuthUser,
  CreatedApiKey,
  LoginResponse,
  MfaStatus,
  MyContributionsResponse,
  PasskeyOptions,
  RecoveryCodes,
  SavedCompanyItem,
  SavedStatus,
  SetupCompleteResponse,
  SetupPasskeyOptions,
  TotpSetup,
  WebAuthnOptionsJSON,
} from '@repo/api';

import { ApiKeysService } from '../api-keys/api-keys.service';
import { CreateApiKeyDto } from '../api-keys/dto/create-api-key.dto';
import { UsersService } from '../users/users.service';
import { AuthService, toAuthUser } from './auth.service';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChallengeDto,
  MfaVerifyDto,
  PasskeyLoginDto,
  PasskeyRegisterDto,
  PasswordConfirmDto,
  SetupPasskeyDto,
  SetupTotpConfirmDto,
  TotpConfirmDto,
} from './dto/mfa.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TurnstileGuard } from './guards/turnstile.guard';
import { MfaService } from './mfa/mfa.service';
import { PasskeyService } from './mfa/passkey.service';
import { AuthThrottle } from '../throttle/throttle';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly apiKeys: ApiKeysService,
    private readonly mfa: MfaService,
    private readonly passkeys: PasskeyService,
    private readonly config: ConfigService,
  ) {}

  /** Where emailed links point: the public web origin. */
  private siteUrl(): string {
    return this.config.get<string>('SITE_URL', 'http://localhost:3001');
  }

  @AuthThrottle()
  @UseGuards(TurnstileGuard)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto, this.siteUrl());
  }

  /** `ok` carries the session; `mfa` / `mfa_setup` carry a challenge for the next step. */
  @AuthThrottle()
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto);
  }

  /** The second step: a TOTP code, a recovery code, or a passkey assertion. */
  @AuthThrottle()
  @Post('login/mfa')
  @HttpCode(200)
  completeMfa(@Body() dto: MfaVerifyDto): Promise<LoginResponse> {
    return this.auth.completeMfa(dto);
  }

  /** Assertion options for the second step, limited to the account's passkeys. */
  @AuthThrottle()
  @Post('login/mfa/passkey-options')
  @HttpCode(200)
  async passkeySecondFactorOptions(@Body() dto: ChallengeDto): Promise<{ options: WebAuthnOptionsJSON }> {
    return { options: await this.auth.passkeySecondFactorOptions(dto.challenge) };
  }

  /** Passwordless sign-in, step one: options for any discoverable passkey on this site. */
  @AuthThrottle()
  @Post('passkey/options')
  @HttpCode(200)
  passkeyOptions(): Promise<PasskeyOptions> {
    return this.passkeys.passwordlessOptions();
  }

  /** Passwordless sign-in, step two: a verified assertion is a session. */
  @AuthThrottle()
  @Post('passkey/login')
  @HttpCode(200)
  passkeyLogin(@Body() dto: PasskeyLoginDto): Promise<LoginResponse> {
    return this.auth.passkeyLogin(dto);
  }

  /** Forced setup with a passkey: registration options. */
  @AuthThrottle()
  @Post('login/setup/passkey-options')
  @HttpCode(200)
  setupPasskeyOptions(@Body() dto: ChallengeDto): Promise<SetupPasskeyOptions> {
    return this.auth.setupPasskeyOptions(dto.challenge);
  }

  /** Forced setup with a passkey: register it; answers the session and the recovery codes. */
  @AuthThrottle()
  @Post('login/setup/passkey')
  @HttpCode(200)
  setupPasskey(@Body() dto: SetupPasskeyDto): Promise<SetupCompleteResponse> {
    return this.auth.setupPasskey(dto);
  }

  /** Forced setup (an MFA_SETUP challenge): start an authenticator-app enrollment. */
  @AuthThrottle()
  @Post('login/setup/totp')
  @HttpCode(200)
  setupTotp(@Body() dto: ChallengeDto): Promise<TotpSetup> {
    return this.auth.setupTotp(dto.challenge);
  }

  /** Forced setup: confirm the app; answers the session and the recovery codes, once. */
  @AuthThrottle()
  @Post('login/setup/totp/confirm')
  @HttpCode(200)
  confirmSetupTotp(@Body() dto: SetupTotpConfirmDto): Promise<SetupCompleteResponse> {
    return this.auth.confirmSetupTotp(dto.challenge, dto.totpChallenge, dto.code);
  }

  /** Always 200, whether or not the email is registered. */
  @AuthThrottle()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.auth.requestPasswordReset(dto.email, this.siteUrl());
    return { ok: true };
  }

  @AuthThrottle()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  /** Public: the token is the credential, and the link may be opened on another device. */
  @AuthThrottle()
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

  // --- Two-factor authentication (signed in) ------------------------------------
  // Every change asks for the current password and emails a security notice.

  @UseGuards(JwtAuthGuard)
  @Get('me/mfa')
  async mfaStatus(@CurrentUser() current: RequestUser): Promise<MfaStatus> {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException('User not found');
    return this.mfa.status(user);
  }

  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/mfa/totp')
  @HttpCode(200)
  async beginTotp(
    @CurrentUser() current: RequestUser,
    @Body() dto: PasswordConfirmDto,
  ): Promise<TotpSetup> {
    return this.mfa.beginTotp(await this.auth.confirmPassword(current.id, dto.password));
  }

  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/mfa/totp/confirm')
  @HttpCode(200)
  async confirmTotp(
    @CurrentUser() current: RequestUser,
    @Body() dto: TotpConfirmDto,
  ): Promise<RecoveryCodes> {
    return { recoveryCodes: await this.mfa.confirmTotp(current.id, dto.challenge, dto.code) };
  }

  /** A POST rather than a DELETE with a body, which some proxies drop. */
  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/mfa/totp/disable')
  @HttpCode(200)
  async disableTotp(
    @CurrentUser() current: RequestUser,
    @Body() dto: PasswordConfirmDto,
  ): Promise<MfaStatus> {
    await this.auth.confirmPassword(current.id, dto.password);
    await this.mfa.disableTotp(current.id);
    return this.mfaStatus(current);
  }

  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/mfa/recovery-codes')
  @HttpCode(200)
  async regenerateRecoveryCodes(
    @CurrentUser() current: RequestUser,
    @Body() dto: PasswordConfirmDto,
  ): Promise<RecoveryCodes> {
    await this.auth.confirmPassword(current.id, dto.password);
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(current.id) };
  }

  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/passkeys/options')
  @HttpCode(200)
  async passkeyRegistrationOptions(
    @CurrentUser() current: RequestUser,
    @Body() dto: PasswordConfirmDto,
  ): Promise<PasskeyOptions> {
    return this.passkeys.registrationOptions(
      await this.auth.confirmPassword(current.id, dto.password),
    );
  }

  /** The password was checked when the options were issued; the challenge carries that. */
  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/passkeys')
  @HttpCode(200)
  async registerPasskey(
    @CurrentUser() current: RequestUser,
    @Body() dto: PasskeyRegisterDto,
  ): Promise<RecoveryCodes> {
    return {
      recoveryCodes: await this.passkeys.register(current.id, dto.challenge, dto.response, dto.name),
    };
  }

  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/passkeys/:id/remove')
  @HttpCode(200)
  async removePasskey(
    @CurrentUser() current: RequestUser,
    @Param('id') id: string,
    @Body() dto: PasswordConfirmDto,
  ): Promise<MfaStatus> {
    const user = await this.auth.confirmPassword(current.id, dto.password);
    await this.passkeys.remove(user, id);
    return this.mfaStatus(current);
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

  /** The caller's own active API keys (never the secrets). */
  @UseGuards(JwtAuthGuard)
  @Get('me/api-keys')
  listApiKeys(@CurrentUser() current: RequestUser): Promise<ApiKeySummary[]> {
    return this.apiKeys.list(current.id);
  }

  /** Mint a key. The response is the only time its secret is ever sent. */
  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  @Post('me/api-keys')
  createApiKey(
    @CurrentUser() current: RequestUser,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(current, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/api-keys/:id')
  @HttpCode(204)
  async revokeApiKey(@CurrentUser() current: RequestUser, @Param('id') id: string): Promise<void> {
    await this.apiKeys.revoke(current.id, id);
  }
}
