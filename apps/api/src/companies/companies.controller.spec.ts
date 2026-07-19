import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
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
      providers: [{ provide: CompaniesService, useValue: { listSlugs, getCompanyDetail } }],
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

  it('serves GET /companies/sitemap from listSlugs, not the :slug route', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/companies/sitemap')
      .expect(200);

    expect(res.body).toEqual([{ slug: 'helia', updatedAt: '2026-07-01T10:30:00.000Z' }]);
    expect(listSlugs).toHaveBeenCalled();
    expect(getCompanyDetail).not.toHaveBeenCalled();
  });
});
