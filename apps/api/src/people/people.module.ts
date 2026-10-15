import { Module } from '@nestjs/common';

import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

@Module({
  controllers: [PeopleController],
  providers: [PeopleService],
  // The admin suppression endpoints and the public API (/v1) call straight into it.
  exports: [PeopleService],
})
export class PeopleModule {}
