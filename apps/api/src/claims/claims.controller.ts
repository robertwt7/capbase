import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  CompanyClaimView,
  ConfirmClaimResponse,
  MyCompanyClaim,
  VerifyClaimResponse,
} from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TurnstileGuard } from '../auth/guards/turnstile.guard';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import { AuthThrottle } from '../throttle/throttle';
import { ClaimsService } from './claims.service';
import { ClaimRequestDto, StartEmailClaimDto, VerifyClaimDto } from './dto/claim.dto';

/**
 * "This is my company". No `/v1` route: a claim is made on the website only. Starting a claim
 * or sending a request is not a contribution (no pending cap), but it needs a verified account
 * email and a Turnstile pass, cheapest first.
 */
@Controller()
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('companies/:slug/claim')
  @Header('Cache-Control', 'no-store')
  view(@CurrentUser() user: RequestUser, @Param('slug') slug: string): Promise<CompanyClaimView> {
    return this.claims.view(user.id, slug);
  }

  @UseGuards(JwtAuthGuard, VerifiedEmailGuard, TurnstileGuard)
  @Post('companies/:slug/claim/email')
  @HttpCode(200)
  startEmail(
    @CurrentUser() user: RequestUser,
    @Param('slug') slug: string,
    @Body() dto: StartEmailClaimDto,
  ): Promise<{ ok: true }> {
    return this.claims.startEmail(user.id, slug, dto.email);
  }

  @UseGuards(JwtAuthGuard, VerifiedEmailGuard, TurnstileGuard)
  @Post('companies/:slug/claim/request')
  request(
    @CurrentUser() user: RequestUser,
    @Param('slug') slug: string,
    @Body() dto: ClaimRequestDto,
  ): Promise<MyCompanyClaim> {
    return this.claims.request(user.id, slug, dto.note, dto.evidenceUrl);
  }

  @UseGuards(JwtAuthGuard)
  @Post('companies/:slug/claim/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('slug') slug: string,
  ): Promise<ConfirmClaimResponse> {
    return this.claims.confirm(user.id, slug);
  }

  /** Public: the token is the credential, and the link may be opened on another device. */
  @AuthThrottle()
  @Post('claims/verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyClaimDto): Promise<VerifyClaimResponse> {
    return this.claims.verify(dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('auth/me/claims')
  @Header('Cache-Control', 'no-store')
  mine(@CurrentUser() user: RequestUser): Promise<MyCompanyClaim[]> {
    return this.claims.listMine(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('auth/me/claims/:id')
  withdraw(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<MyCompanyClaim> {
    return this.claims.withdraw(user.id, id);
  }
}
