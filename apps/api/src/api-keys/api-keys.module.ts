import { Module } from '@nestjs/common';

import { MfaPolicyModule } from '../auth/mfa/policy';
import { ApiKeysService } from './api-keys.service';

@Module({
  imports: [MfaPolicyModule],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
