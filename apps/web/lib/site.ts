// Canonical site origin for metadata, sitemap, robots, JSON-LD, and OG URLs.
// Server-only (read in RSCs / metadata routes), so a plain env var is fine.
export const SITE_URL = process.env.SITE_URL ?? 'https://capbase.fyi';
export const SITE_NAME = 'Capbase';
export const SUPPORT_EMAIL = 'support@capbase.fyi';
