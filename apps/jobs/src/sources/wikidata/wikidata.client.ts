import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One SPARQL result row: variable name → RDF term (absent when unbound). */
export type SparqlBinding = Record<string, { type: string; value: string } | undefined>;

const WDQS_ENDPOINT = 'https://query.wikidata.org/sparql';
// WDQS asks clients to stay around 1 req/s; be a good citizen.
const MIN_INTERVAL_MS = 1100;
const QUERY_TIMEOUT_MS = 90_000;
const RETRY_BACKOFF_MS = 10_000;

/**
 * Thin client over the Wikidata Query Service. Requests are serialized,
 * throttled to ~1 req/s, carry a descriptive User-Agent, and get one retry
 * with backoff on 429/5xx/timeout.
 */
@Injectable()
export class WikidataClient {
  private readonly logger = new Logger(WikidataClient.name);
  private readonly userAgent: string;
  private lastRequestAt = 0;

  constructor(config: ConfigService) {
    this.userAgent =
      config.get<string>('WDQS_USER_AGENT') ??
      config.get<string>('SEC_USER_AGENT') ??
      'capbase-ingest (contact@example.com)';
  }

  /** Run a SPARQL query, returning its bindings ([] on unrecoverable errors). */
  async runQuery(sparql: string): Promise<SparqlBinding[]> {
    const url = `${WDQS_ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.throttle();
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/sparql-results+json',
          },
          signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
        });
        if (res.status === 429 || res.status >= 500) {
          this.logger.warn(`WDQS ${res.status} — ${attempt === 0 ? 'retrying after backoff' : 'giving up'}`);
          if (attempt === 0) await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        if (!res.ok) {
          this.logger.warn(`WDQS ${res.status}: ${(await res.text()).slice(0, 200)}`);
          return [];
        }
        const json = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
        return json.results?.bindings ?? [];
      } catch (err) {
        this.logger.warn(
          `WDQS request failed (${String(err)}) — ${attempt === 0 ? 'retrying after backoff' : 'giving up'}`,
        );
        if (attempt === 0) await sleep(RETRY_BACKOFF_MS);
      }
    }
    return [];
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
