import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

// Route-order regression test: GET /companies/sitemap must resolve to the
// literal `sitemap` handler, not be swallowed by the `:slug` param route.
describe('CompaniesController routing', () => {
  let app: INestApplication;
  const listSlugs = jest.fn(async () => [
    { slug: 'helia', updatedAt: '2026-07-01T10:30:00.000Z' },
  ]);
  const getCompanyDetail = jest.fn(async () => {
    throw new Error('sitemap request must not hit the :slug handler');
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        { provide: CompaniesService, useValue: { listSlugs, getCompanyDetail } },
        // The contribution routes' guards need these to be constructible.
        { provide: UsersService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires JWT and persistent contributor/admin roles for history', () => {
    const handler = CompaniesController.prototype.history;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['CONTRIBUTOR', 'ADMIN']);
  });

  it('serves GET /companies/sitemap from listSlugs, not the :slug route', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/companies/sitemap')
      .expect(200);

    expect(res.body).toEqual([{ slug: 'helia', updatedAt: '2026-07-01T10:30:00.000Z' }]);
    expect(listSlugs).toHaveBeenCalled();
    expect(getCompanyDetail).not.toHaveBeenCalled();
  });
});
