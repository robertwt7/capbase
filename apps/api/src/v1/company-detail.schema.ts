/** Optional detail-only enrichment fields; directory schemas deliberately omit them. */
export const COMPANY_DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    company: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        companyTechnologies: {
          type: 'array',
          description: 'Optional public homepage observations. Current elected target only; expires after 60 days.',
          items: {
            type: 'object',
            required: ['id', 'slug', 'name', 'category', 'vendorUrl', 'evidenceUrl', 'evidence', 'firstSeenAt', 'lastSeenAt'],
            properties: {
              id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' },
              category: { type: 'string' }, vendorUrl: { type: 'string', format: 'uri' },
              evidenceUrl: { type: 'string', format: 'uri' }, evidence: { type: 'string' },
              firstSeenAt: { type: 'string', format: 'date-time' },
              lastSeenAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        companyApps: {
          type: 'array',
          description: 'Optional verified outgoing store links; no download or catalog metrics.',
          items: {
            type: 'object',
            required: ['id', 'store', 'appId', 'storeUrl', 'evidenceUrl', 'verifiedAt', 'lastSeenAt'],
            properties: {
              id: { type: 'string' }, store: { type: 'string', enum: ['APPLE', 'GOOGLE_PLAY'] },
              appId: { type: 'string' }, storeUrl: { type: 'string', format: 'uri' },
              evidenceUrl: { type: 'string', format: 'uri' },
              verifiedAt: { type: 'string', format: 'date-time' },
              lastSeenAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    access: {
      type: 'object',
      properties: {
        totals: {
          type: 'object',
          properties: {
            companyTechnologies: { type: 'integer', minimum: 0 },
            companyApps: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    citations: { type: 'array', items: { type: 'object' }, description: 'Sources only for returned rows.' },
    latestRound: { type: 'object', nullable: true },
  },
};
