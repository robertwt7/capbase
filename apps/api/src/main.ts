// Must stay the first import — see instrument.ts.
import './instrument';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { parseTrustProxy } from './throttle/throttle';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // The web forwards each visitor's IP in X-Forwarded-For; believe it only from
  // the private network it sits on, so req.ip (the throttler's key) can't be
  // spoofed by a direct caller. validateEnv has already rejected a bad value.
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
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
