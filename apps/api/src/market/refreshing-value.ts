import { Logger } from '@nestjs/common';

/**
 * A value loaded on first read, then served from memory and refreshed in the background once it
 * is older than `ttlMs` (the `GatePolicyService` pattern). Only the first read waits on `load`;
 * every later read returns at once, an expired value while one refresh runs. Concurrent cold
 * reads share one load, and a failed refresh keeps the last value and waits out another TTL
 * rather than retrying on every request.
 */
export class RefreshingValue<T> {
  private readonly logger = new Logger(RefreshingValue.name);
  private value: T | undefined;
  private loadedAt = 0;
  private loading: Promise<T> | null = null;

  constructor(
    private readonly name: string,
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
  ) {}

  async get(): Promise<T> {
    if (this.value === undefined) return this.reload();
    if (Date.now() - this.loadedAt > this.ttlMs && !this.loading) {
      void this.reload().catch((err: unknown) => {
        this.loadedAt = Date.now();
        this.logger.error(`${this.name} refresh failed, keeping the last value: ${String(err)}`);
      });
    }
    return this.value;
  }

  /** Forget the value, so the next read loads afresh (tests). */
  reset(): void {
    this.value = undefined;
  }

  private reload(): Promise<T> {
    this.loading ??= this.load()
      .then((value) => {
        this.value = value;
        this.loadedAt = Date.now();
        return value;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
}
