import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

// Long-running worker: an HTTP server (health endpoint for Docker) plus the
// scheduled ingest registered by ScheduleModule / IngestScheduler.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port);
  new Logger('Jobs').log(`Worker listening on :${port}`);
}

void bootstrap();
