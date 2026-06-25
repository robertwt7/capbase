import { Body, Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import type { AuthResponse, AuthUser, MyContributionsResponse } from '@repo/api';

import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
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
}
