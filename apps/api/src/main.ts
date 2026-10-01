import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  // The API is internal: only the web server calls it, server-side, so the
  // browser never needs CORS. Opt in with CORS_ORIGIN when exposing it.
  if (process.env.CORS_ORIGIN) {
    app.enableCors({ origin: process.env.CORS_ORIGIN.split(',') });
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Lets Prisma disconnect cleanly on `docker stop` (SIGTERM).
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
