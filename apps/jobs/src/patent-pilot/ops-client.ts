export interface OpsTransport {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export class OpsRequestError extends Error {
  constructor(readonly status: number, readonly retryable: boolean, readonly retryAfterSeconds: number | null) {
    super(`OPS request returned HTTP ${status}${retryable ? ' (retryable)' : ''}`);
  }
}

/** Fixed EPO endpoints only; redirects cannot send credentials to another host. */
export class OpsClient {
  requests = 0;
  bytes = 0;
  private lastRequestAt: number | null = null;
  private readonly startedAt: number;
  private token: string | null = null;

  constructor(
    private readonly key: string,
    private readonly secret: string,
    private readonly maxRequests = 100,
    private readonly transport: OpsTransport = {
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
    },
  ) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100) {
      throw new Error('Request limit must be an integer from 1 to 100');
    }
    this.startedAt = transport.now();
  }

  private async request(url: string, init: RequestInit): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.requests >= this.maxRequests) throw new Error('OPS pilot request limit reached');
      if (this.bytes >= 20 * 1024 * 1024) throw new Error('OPS pilot response byte limit reached');
      if (this.transport.now() - this.startedAt >= 15 * 60_000) throw new Error('OPS pilot deadline reached');
      if (this.lastRequestAt !== null) {
        await this.transport.sleep(Math.max(0, 1000 - (this.transport.now() - this.lastRequestAt)));
      }
      this.requests++;
      this.lastRequestAt = this.transport.now();
      const response = await this.transport.fetch(url, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const header = response.headers.get('retry-after');
        const seconds = header === null ? null : /^\d+$/.test(header) ? Number(header) :
          Math.max(0, Math.ceil((Date.parse(header) - this.transport.now()) / 1000));
        const retryAfter = seconds !== null && Number.isFinite(seconds) ? seconds : null;
        const retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        if (retryable && attempt === 0 && (retryAfter ?? 2) <= 60) {
          await this.transport.sleep(Math.max(2000, (retryAfter ?? 2) * 1000));
          continue;
        }
        throw new OpsRequestError(response.status, retryable, retryAfter);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('OPS response has no body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          this.bytes += value.length;
          if (size > 2 * 1024 * 1024 || this.bytes > 20 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('OPS pilot response byte limit reached');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    throw new Error('OPS retry budget reached');
  }

  async authenticate(): Promise<void> {
    const raw = await this.request('https://ops.epo.org/3.2/auth/accesstoken', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.key}:${this.secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const json = JSON.parse(raw) as { access_token?: unknown };
    if (typeof json.access_token !== 'string' || !json.access_token) throw new Error('OPS token response is invalid');
    this.token = json.access_token;
  }

  async search(query: string, begin: number, end: number): Promise<string> {
    if (!this.token) throw new Error('OPS authentication required');
    if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 1 || end < begin || end - begin >= 100 || end > 2000) {
      throw new Error('Invalid OPS search range');
    }
    const url = new URL('https://ops.epo.org/3.2/rest-services/published-data/search/biblio');
    url.searchParams.set('q', query);
    return this.request(url.href, {
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/exchange+xml', 'X-OPS-Range': `${begin}-${end}` },
    });
  }
}
