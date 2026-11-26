import { Logger } from '@nestjs/common';

import { RefreshingValue } from './refreshing-value';

const TTL = 1_000;

/** A load whose every call can be resolved or rejected by hand. */
function controlledLoad() {
  const calls: { resolve: (v: number) => void; reject: (e: Error) => void }[] = [];
  const load = jest.fn(
    () => new Promise<number>((resolve, reject) => calls.push({ resolve, reject })),
  );
  return { load, calls };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('RefreshingValue', () => {
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('loads on the first read and serves from memory inside the TTL', async () => {
    let n = 0;
    const load = jest.fn(async () => ++n);
    const value = new RefreshingValue('test', TTL, load);

    expect(await value.get()).toBe(1);
    now += TTL;
    expect(await value.get()).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent cold reads', async () => {
    const { load, calls } = controlledLoad();
    const value = new RefreshingValue('test', TTL, load);

    const reads = [value.get(), value.get(), value.get()];
    calls[0]!.resolve(7);
    expect(await Promise.all(reads)).toEqual([7, 7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the expired value at once and refreshes it once in the background', async () => {
    const { load, calls } = controlledLoad();
    const value = new RefreshingValue('test', TTL, load);
    const first = value.get();
    calls[0]!.resolve(1);
    await first;

    now += TTL + 1;
    expect(await value.get()).toBe(1);
    expect(await value.get()).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);

    calls[1]!.resolve(2);
    await flush();
    expect(await value.get()).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the last value when a refresh fails, and waits a TTL before retrying', async () => {
    const { load, calls } = controlledLoad();
    const value = new RefreshingValue('test', TTL, load);
    const first = value.get();
    calls[0]!.resolve(1);
    await first;

    now += TTL + 1;
    expect(await value.get()).toBe(1);
    calls[1]!.reject(new Error('pool timeout'));
    await flush();

    expect(await value.get()).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('test refresh failed, keeping the last value'),
    );

    now += TTL + 1;
    await value.get();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('a failed first load rejects, and the next read tries again', async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(5);
    const value = new RefreshingValue<number>('test', TTL, load);

    await expect(value.get()).rejects.toThrow('down');
    expect(await value.get()).toBe(5);
  });

  it('reset makes the next read load afresh', async () => {
    let n = 0;
    const value = new RefreshingValue('test', TTL, async () => ++n);

    expect(await value.get()).toBe(1);
    value.reset();
    expect(await value.get()).toBe(2);
  });
});
