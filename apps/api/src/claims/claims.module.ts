import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module';
import { AdminClaimsController } from './admin-claims.controller';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

@Module({
  imports: [MailModule],
  controllers: [ClaimsController, AdminClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
