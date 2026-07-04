import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type {
  AuthResponse,
  AuthUser,
  MyContributionsResponse,
  SavedCompanyItem,
  SavedStatus,
} from '@repo/api';

import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() current: RequestUser): Promise<AuthUser> {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException('User not found');
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(
    @CurrentUser() current: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    return this.auth.updateProfile(current.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/password')
  async changePassword(
    @CurrentUser() current: RequestUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(current.id, dto);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/contributions')
  async myContributions(@CurrentUser() current: RequestUser): Promise<MyContributionsResponse> {
    const [items, until] = await Promise.all([
      this.users.listContributions(current.id),
      this.users.unlockedUntil(current.id),
    ]);
    const unlocked = until !== null && new Date() < until;
    return {
      access: { unlocked, unlockedUntil: until ? until.toISOString() : null },
      items,
    };
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
