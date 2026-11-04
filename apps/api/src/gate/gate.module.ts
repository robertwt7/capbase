import { Global, Module } from '@nestjs/common';

import { AdminVisibilityController } from './admin-visibility.controller';
import { GatePolicyService } from './gate-policy.service';

/** The read gate's live policy, for every read that gates. Global: imported
 *  once by `AppModule`. */
@Global()
@Module({
  controllers: [AdminVisibilityController],
  providers: [GatePolicyService],
  exports: [GatePolicyService],
})
export class GateModule {}
