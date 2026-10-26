import { ConfigService } from '@nestjs/config';

import { parseEnrichmentArgs, readEnrichmentConfig } from './enrichment-config';

const config = (env: Record<string, string> = {}) => new ConfigService(env);

describe('bounded opt-in enrichment configuration', () => {
  it('defaults to disabled with no cohort and an hourly five-site UTC budget', () => {
    expect(readEnrichmentConfig(config())).toMatchObject({ enabled: false, companyIds: [], schedule: '0 * * * *', limit: 5, timeoutMs: 300_000, refreshDays: 30 });
  });
  it('deduplicates only the explicit cohort IDs', () => {
    expect(readEnrichmentConfig(config({ TECH_ENRICHMENT_ENABLED: 'true', TECH_ENRICHMENT_COMPANY_IDS: 'company-b, company-a,company-b, ' })).companyIds).toEqual(['company-b', 'company-a']);
  });
  it.each([
    ['TECH_ENRICHMENT_LIMIT', '0'], ['TECH_ENRICHMENT_LIMIT', '101'], ['TECH_ENRICHMENT_LIMIT', '1.5'],
    ['TECH_ENRICHMENT_TIMEOUT_MS', '0'], ['TECH_ENRICHMENT_TIMEOUT_MS', '300001'],
    ['TECH_ENRICHMENT_REFRESH_DAYS', '0'], ['TECH_ENRICHMENT_REFRESH_DAYS', '61'],
    ['TECH_ENRICHMENT_COMPANY_IDS', 'company-a,*'], ['TECH_ENRICHMENT_SCHEDULE', 'never'],
    ['TECH_ENRICHMENT_USER_AGENT', 'anonymous crawler'], ['TECH_ENRICHMENT_USER_AGENT', 'Capbase (+https://capbase.fyi/data)\nHeader: injected'],
    ['TECH_ENRICHMENT_HEARTBEAT_URL', 'file:///tmp/heartbeat'], ['TECH_ENRICHMENT_HEARTBEAT_URL', 'https://user:secret@example.com/'],
  ])('rejects unsafe enabled %s=%s', (key, value) => {
    expect(() => readEnrichmentConfig(config({ TECH_ENRICHMENT_ENABLED: 'true', [key]: value }))).toThrow(key);
  });
  it('rejects an ambiguous enabled switch', () => {
    expect(() => readEnrichmentConfig(config({ TECH_ENRICHMENT_ENABLED: 'yes' }))).toThrow('TECH_ENRICHMENT_ENABLED');
  });
  it('permits an empty enabled cohort without selecting the full corpus', () => {
    expect(readEnrichmentConfig(config({ TECH_ENRICHMENT_ENABLED: 'true' })).companyIds).toEqual([]);
  });
  it('caps the explicit cohort', () => {
    const ids = Array.from({ length: 10_001 }, (_, index) => `company-${index}`).join(',');
    expect(() => readEnrichmentConfig(config({ TECH_ENRICHMENT_ENABLED: 'true', TECH_ENRICHMENT_COMPANY_IDS: ids }))).toThrow('TECH_ENRICHMENT_COMPANY_IDS');
  });
  it('validates manual collection even while cron is disabled', () => {
    const disabled = config({ TECH_ENRICHMENT_ENABLED: 'false', TECH_ENRICHMENT_LIMIT: '1000000' });
    expect(readEnrichmentConfig(disabled).enabled).toBe(false);
    expect(() => readEnrichmentConfig(disabled, { forCli: true })).toThrow('TECH_ENRICHMENT_LIMIT');
  });
});

describe('technology backfill arguments', () => {
  it('defaults to the configured bounded cohort and limit', () => expect(parseEnrichmentArgs([])).toEqual({}));
  it('accepts explicit dry-run, limit and slug without changing cohort configuration', () => {
    expect(parseEnrichmentArgs(['--limit', '100', '--dry-run', '--slug', 'example-company'])).toEqual({ limit: 100, dryRun: true, slug: 'example-company' });
  });
  it.each([
    ['--dryrun'], ['--dry-run=false'], ['--limit', '0'], ['--limit', '101'], ['--limit', '1.5'],
    ['--limit'], ['--slug'], ['--slug', '*'], ['--dry-run', '--dry-run'], ['--limit', '5', '--limit', '10'],
  ])('rejects typo, unbounded or ambiguous options %j', (...args) => expect(() => parseEnrichmentArgs(args)).toThrow());
});

it('requires identity and an audit reason for group-wide technology suppression', () => {
  expect(parseEnrichmentArgs(['--suppress-scan', 'scan-1', '--technology', 'wordpress', '--reason', 'Incorrect generator', '--unsuppress'])).toEqual({ suppressScan: 'scan-1', technology: 'wordpress', reason: 'Incorrect generator', unsuppress: true });
});
it('requires explicit evidence for app verification', () => {
  expect(parseEnrichmentArgs(['--app-link', 'link-1', '--app-action', 'verify', '--reason', 'Reviewed company ownership', '--evidence-url', 'https://company.com/apps'])).toMatchObject({ appLink: 'link-1', appAction: 'verify', evidenceUrl: 'https://company.com/apps' });
});
it.each([
  ['--suppress-scan', 'scan-1', '--technology', 'wordpress'],
  ['--suppress-scan', 'scan-1', '--reason', 'Missing slug'],
  ['--unsuppress'], ['--technology', 'wordpress'], ['--reason', 'Unscoped'],
  ['--app-link', 'link-1', '--app-action', 'verify', '--reason', 'Missing evidence'],
  ['--app-link', 'link-1', '--app-action', 'transfer', '--reason', 'Bad action'],
  ['--app-link', 'link-1', '--app-action', 'verify', '--reason', 'Bad URL', '--evidence-url', 'file:///tmp/evidence'],
  ['--app-link', 'link-1', '--app-action', 'suppress', '--reason', 'No dry writes', '--dry-run'],
  ['--app-link', 'link-1', '--app-action', 'suppress', '--reason', 'Mixed', '--suppress-scan', 'scan-1', '--technology', 'wordpress'],
])('rejects unauditable or mixed correction options %j', (...args) => expect(() => parseEnrichmentArgs(args)).toThrow());
