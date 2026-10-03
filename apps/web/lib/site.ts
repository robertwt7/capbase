// Canonical site origin for metadata, sitemap, robots, JSON-LD, and OG URLs.
// Server-only (read in RSCs / metadata routes), so a plain env var is fine.
export const SITE_URL = process.env.SITE_URL ?? 'https://capbase.fyi';
export const SITE_NAME = 'Capbase';
export const SUPPORT_EMAIL = 'support@capbase.fyi';

// AGPL-3.0 §13: anyone using the hosted service must be offered the source.
export const SOURCE_URL = 'https://github.com/robertwt7/capbase';
export const DATA_LICENSE_URL = 'https://creativecommons.org/licenses/by-nc/4.0/';
