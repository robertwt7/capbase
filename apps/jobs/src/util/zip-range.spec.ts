import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { zipSync, strToU8 } from 'fflate';

import { fetchTail, parseCentralDirectory, streamZipMember } from './zip-range';

const OPTS = { userAgent: 'capbase-test (test@example.com)' };

/** A real archive, so the parser is tested against bytes fflate produced
 *  rather than a hand-rolled header. */
function archive(members: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(members).map(([name, body]) => [name, strToU8(body)])),
  );
}

/** Deterministic pseudo-random text — deflate cannot shrink it much. */
function noise(length: number): string {
  let seed = 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += String.fromCharCode(32 + (seed % 95));
  }
  return out;
}

/** Serve byte ranges out of an in-memory archive, the way sec.gov does. */
function rangeServer(zip: Uint8Array, opts: { honourRange?: boolean } = {}) {
  return jest.fn(async (_url: unknown, init: unknown) => {
    const headers = (init as { headers: Record<string, string> }).headers;
    const range = headers.Range ?? '';
    if (opts.honourRange === false) {
      return { status: 200, body: null, arrayBuffer: async () => zip.buffer } as unknown as Response;
    }

    let slice: Uint8Array;
    const suffix = /^bytes=-(\d+)$/.exec(range);
    const window = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (suffix) slice = zip.subarray(Math.max(0, zip.length - Number(suffix[1])));
    else if (window) slice = zip.subarray(Number(window[1]), Number(window[2]) + 1);
    else slice = zip;

    return {
      status: 206,
      arrayBuffer: async () => slice.slice().buffer,
      // A ReadableStream would do, but chunked async iteration is what the
      // reader actually consumes and it exercises the header-skip path.
      body: (async function* () {
        for (let i = 0; i < slice.length; i += 7) yield slice.subarray(i, i + 7);
      })(),
    } as unknown as Response;
  });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('parseCentralDirectory', () => {
  it('reads every member of a real archive', () => {
    const zip = archive({ 'a.csv': 'one,two\n1,2\n', 'b.txt': 'hello' });
    const entries = parseCentralDirectory(zip);

    expect(entries.map((e) => e.name).sort()).toEqual(['a.csv', 'b.txt']);
    const a = entries.find((e) => e.name === 'a.csv')!;
    expect(a.uncompressedSize).toBe('one,two\n1,2\n'.length);
    expect(a.compressedSize).toBeGreaterThan(0);
  });

  it('finds the directory when handed only the archive tail, mid-record', () => {
    // Incompressible payloads, so the tail genuinely starts inside member data
    // rather than covering the whole archive.
    const zip = archive({ 'members1.csv': noise(2000), 'members2.csv': noise(2000) });
    const whole = parseCentralDirectory(zip);
    const tail = zip.subarray(zip.length - 200);

    expect(tail.length).toBeLessThan(zip.length);
    expect(parseCentralDirectory(tail)).toEqual(whole);
  });

  it('does not mistake member CONTENT that looks like a header for one', () => {
    // The central-directory signature appearing inside a stored payload must
    // not produce a phantom entry with a bogus offset.
    const zip = archive({ 'evil.bin': 'PK\x01\x02'.repeat(40) });
    const entries = parseCentralDirectory(zip);

    expect(entries.map((e) => e.name)).toEqual(['evil.bin']);
  });

  it('preserves non-ASCII member names', () => {
    const zip = archive({ 'société.csv': 'a' });
    expect(parseCentralDirectory(zip).map((e) => e.name)).toEqual(['société.csv']);
  });

  it('returns nothing for bytes that are not a ZIP', () => {
    expect(parseCentralDirectory(strToU8('not a zip at all'))).toEqual([]);
  });
});

describe('streamZipMember', () => {
  it('inflates one member without reading the rest of the archive', async () => {
    const body = 'FilingID,Fund Name\n1,ACME FUND I\n2,ACME FUND II\n';
    const zip = archive({ 'big.csv': 'z'.repeat(20_000), 'wanted.csv': body });
    globalThis.fetch = rangeServer(zip) as unknown as typeof fetch;

    const entry = parseCentralDirectory(zip).find((e) => e.name === 'wanted.csv')!;
    let out = '';
    const ok = await streamZipMember('https://sec.gov/a.zip', entry, OPTS, (t) => {
      out += t;
    });

    expect(ok).toBe(true);
    expect(out).toBe(body);
  });

  it('fails rather than returning data when the server ignores Range', async () => {
    const zip = archive({ 'wanted.csv': 'a,b\n1,2\n' });
    globalThis.fetch = rangeServer(zip, { honourRange: false }) as unknown as typeof fetch;

    const entry = parseCentralDirectory(zip).find((e) => e.name === 'wanted.csv')!;
    let out = '';
    const ok = await streamZipMember('https://sec.gov/a.zip', entry, OPTS, (t) => {
      out += t;
    });

    expect(ok).toBe(false);
    expect(out).toBe('');
  });

  it('refuses a Zip64-sized member instead of range-fetching 4 GB', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    const ok = await streamZipMember(
      'https://sec.gov/a.zip',
      { name: 'huge.csv', offset: 0, compressedSize: 0xffffffff, uncompressedSize: 0, method: 8 },
      OPTS,
      () => {},
    );

    expect(ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('fetchTail', () => {
  it('range-fetches the last bytes of the archive', async () => {
    const zip = archive({ 'a.csv': 'hello' });
    globalThis.fetch = rangeServer(zip) as unknown as typeof fetch;

    const tail = await fetchTail('https://sec.gov/a.zip', 128, OPTS);
    expect(tail).not.toBeNull();
    expect(parseCentralDirectory(tail!).map((e) => e.name)).toEqual(['a.csv']);
  });
});
