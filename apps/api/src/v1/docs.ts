import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { V1Module } from './v1.module';

/** Where the public API's docs live. Both are public and need no key. */
export const API_DOCS_PATH = 'v1/docs';
export const API_SPEC_PATH = 'v1/openapi.json';

/**
 * Serve the OpenAPI 3 document for the `/v1` module only (Swagger UI at /v1/docs, JSON at
 * /v1/openapi.json). Request bodies and query params come from the DTO classes through the
 * @nestjs/swagger CLI plugin (nest-cli.json); responses are described per route. Served by
 * SwaggerModule outside the controllers, so neither the key guard nor the throttler applies.
 */
export function setupApiDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Capbase API')
    .setVersion('1')
    .setDescription(
      'Read and contribute to Capbase. Get a key at https://capbase.fyi/profile/api-keys — ' +
        'the guide is at https://capbase.fyi/developers.\n\n' +
        'Every route needs `Authorization: Bearer cbk_…`. Contributor keys create PENDING ' +
        'submissions for the moderation queue; admin keys publish at once and may moderate.',
    )
    // Same origin first, so "Try it out" from a local or staging copy calls itself.
    .addServer('/', 'This server')
    .addServer('https://capbase.fyi', 'Production')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'cbk_… API key' }, 'apiKey')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    include: [V1Module],
  });
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: API_SPEC_PATH,
    // No YAML twin: one spec URL to document.
    yamlDocumentUrl: undefined,
    customSiteTitle: 'Capbase API',
    swaggerOptions: { persistAuthorization: false },
  });
}
