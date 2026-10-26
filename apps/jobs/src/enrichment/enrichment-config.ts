import type { ConfigService } from '@nestjs/config';
import { CronTime } from 'cron';

export interface EnrichmentConfig {
  enabled: boolean;
  companyIds: string[];
  schedule: string;
  limit: number;
  timeoutMs: number;
  refreshDays: number;
  userAgent: string;
  heartbeatUrl: string | undefined;
}

/** Cron and CLI share the same capacity and cohort contract. Disabling cron does
 * not disable bounded manual runs; CLI callers explicitly request validation. */
export function readEnrichmentConfig(
  config: Pick<ConfigService, 'get'>,
  options: { forCli?: boolean } = {},
): EnrichmentConfig {
  const rawEnabled = String(config.get<string>('TECH_ENRICHMENT_ENABLED') ?? 'false').trim();
  if (rawEnabled !== 'true' && rawEnabled !== 'false') throw new Error('TECH_ENRICHMENT_ENABLED must be true or false');
  const enabled = rawEnabled === 'true';
  const strict = enabled || options.forCli === true;
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const raw = config.get<string>(key);
    const value = raw === undefined || String(raw).trim() === '' ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      if (strict) throw new Error(`${key} must be an integer from ${min} to ${max}`);
      return fallback;
    }
    return value;
  };
  const companyIds = [...new Set(String(config.get<string>('TECH_ENRICHMENT_COMPANY_IDS') ?? '').split(',').map((value) => value.trim()).filter(Boolean))];
  if (strict && (companyIds.length > 10_000 || companyIds.some((id) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))) {
    throw new Error('TECH_ENRICHMENT_COMPANY_IDS must contain at most 10000 valid company IDs');
  }
  const schedule = config.get<string>('TECH_ENRICHMENT_SCHEDULE')?.trim() || '0 * * * *';
  if (strict) {
    try { new CronTime(schedule, 'UTC'); }
    catch { throw new Error('TECH_ENRICHMENT_SCHEDULE must be a valid UTC cron expression'); }
  }
  const userAgent = config.get<string>('TECH_ENRICHMENT_USER_AGENT')?.trim() || 'CapbaseTechnology/1.0 (+https://capbase.fyi/data)';
  if (strict && (userAgent.length > 256 || /[\r\n]/.test(userAgent) || !/Capbase/i.test(userAgent) || !/(?:https?:\/\/|mailto:)/.test(userAgent))) {
    throw new Error('TECH_ENRICHMENT_USER_AGENT must identify Capbase and include a contact URL or mailto address');
  }
  const heartbeatUrl = config.get<string>('TECH_ENRICHMENT_HEARTBEAT_URL')?.trim() || undefined;
  if (strict && heartbeatUrl) {
    let url: URL;
    try { url = new URL(heartbeatUrl); }
    catch { throw new Error('TECH_ENRICHMENT_HEARTBEAT_URL must be an HTTP(S) URL'); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('TECH_ENRICHMENT_HEARTBEAT_URL must be an HTTP(S) URL without credentials');
  }
  return {
    enabled, companyIds, schedule, userAgent, heartbeatUrl,
    limit: integer('TECH_ENRICHMENT_LIMIT', 5, 1, 100),
    timeoutMs: integer('TECH_ENRICHMENT_TIMEOUT_MS', 300_000, 1000, 300_000),
    refreshDays: integer('TECH_ENRICHMENT_REFRESH_DAYS', 30, 1, 60),
  };
}

export interface EnrichmentCliOptions {
  limit?: number; dryRun?: boolean; slug?: string;
  suppressScan?: string; technology?: string; reason?: string; unsuppress?: boolean;
  appLink?: string; appAction?: 'verify' | 'suppress' | 'unsuppress'; evidenceUrl?: string;
}

/** Parse explicitly supported flags; typos must not turn a dry-run into writes. */
export function parseEnrichmentArgs(argv: string[]): EnrichmentCliOptions {
  const options: EnrichmentCliOptions = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--dry-run') {
      if (options.dryRun) throw new Error('Duplicate --dry-run');
      options.dryRun = true;
    } else if (arg === '--limit') {
      if (options.limit !== undefined) throw new Error('Duplicate --limit');
      const value = argv[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error('--limit must be an integer from 1 to 100');
      options.limit = Number(value);
    } else if (arg === '--slug') {
      if (options.slug !== undefined) throw new Error('Duplicate --slug');
      const value = argv[++index];
      if (!value || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new Error('--slug requires a valid company slug');
      options.slug = value;
    } else if (arg === '--unsuppress') {
      if (options.unsuppress) throw new Error('Duplicate --unsuppress');
      options.unsuppress = true;
    } else if (['--suppress-scan', '--technology', '--reason', '--app-link', '--app-action', '--evidence-url'].includes(arg)) {
      const keys = { '--suppress-scan': 'suppressScan', '--technology': 'technology', '--reason': 'reason', '--app-link': 'appLink', '--app-action': 'appAction', '--evidence-url': 'evidenceUrl' } as const;
      const key = keys[arg as keyof typeof keys];
      if (options[key] !== undefined) throw new Error(`Duplicate ${arg}`);
      const value = argv[++index]?.trim();
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (key === 'appAction') {
        if (!['verify', 'suppress', 'unsuppress'].includes(value)) throw new Error('--app-action must be verify, suppress or unsuppress');
        options.appAction = value as EnrichmentCliOptions['appAction'];
      } else options[key] = value;
    } else throw new Error(`Unsupported technology enrichment argument: ${arg}`);
  }
  const correction = options.suppressScan || options.appLink;
  if (correction && (options.limit !== undefined || options.slug !== undefined || options.dryRun)) throw new Error('Correction actions cannot be mixed with scan or dry-run options');
  if (options.suppressScan && options.appLink) throw new Error('Choose either a technology or app correction');
  if (correction && (!options.reason?.trim() || options.reason.length > 500)) throw new Error('Correction actions require --reason of 1..500 characters');
  if (options.suppressScan) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.suppressScan) || !options.technology || !/^[a-z0-9-]{1,128}$/.test(options.technology)) throw new Error('Technology correction requires a valid --suppress-scan ID and --technology slug');
    if (options.appAction || options.evidenceUrl) throw new Error('App options require --app-link');
  } else if (options.technology || options.unsuppress) throw new Error('--technology and --unsuppress require --suppress-scan');
  if (options.appLink) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.appLink) || !options.appAction) throw new Error('App correction requires a valid --app-link ID and --app-action');
    if (options.appAction === 'verify') {
      let url: URL;
      try { url = new URL(options.evidenceUrl ?? ''); }
      catch { throw new Error('App verification requires --evidence-url'); }
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) throw new Error('--evidence-url must be an HTTP(S) URL without credentials or nonstandard ports');
    } else if (options.evidenceUrl) throw new Error('--evidence-url applies only to app verification');
  } else if (options.appAction || options.evidenceUrl) throw new Error('App options require --app-link');
  if (options.reason && !correction) throw new Error('--reason requires a correction action');
  return options;
}

