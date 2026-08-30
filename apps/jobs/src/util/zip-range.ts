// Reading one member out of a remote ZIP without downloading the archive.
//
// The Form ADV Part 1 archives are 700 MB and 429 MB, and we need four members
// totalling ~180 MB compressed. A ZIP's central directory sits at the end, so
// one range request for the tail yields every member's offset and compressed
// size; a second range request for that extent, piped through inflateRaw, is
// the member. `fflate`'s unzipSync cannot do this — it buffers the whole
// archive, and one member alone is 396 MB uncompressed, past Node's string cap.

import { createInflateRaw } from 'node:zlib';

/** One member of a ZIP, as described by its central-directory entry. */
export interface ZipEntry {
  name: string;
  /** Byte offset of the member's LOCAL file header within the archive. */
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
  /** 0 = stored, 8 = deflate. Anything else we cannot inflate. */
  method: number;
}

/** Central-directory file header signature, `PK\x01\x02`. */
const CD_SIGNATURE = 0x02014b50;
/** Fixed part of a central-directory header, before the name/extra/comment. */
const CD_FIXED_LEN = 46;
/** Fixed part of a local file header, before the name and extra fields. */
const LOCAL_FIXED_LEN = 30;

/**
 * Parse every central-directory entry found in `tail`.
 *
 * `tail` is the last N bytes of the archive, so it may begin mid-record; the
 * scan simply skips anything that is not a well-formed header. Zip64 archives
 * store the real sizes in an extra field — a member whose size reads as
 * 0xFFFFFFFF is reported as-is and the caller must reject it rather than
 * range-fetch 4 GB.
 */
export function parseCentralDirectory(tail: Uint8Array): ZipEntry[] {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const out: ZipEntry[] = [];

  for (let i = 0; i + CD_FIXED_LEN <= tail.length; i++) {
    if (view.getUint32(i, true) !== CD_SIGNATURE) continue;

    const method = view.getUint16(i + 10, true);
    const compressedSize = view.getUint32(i + 20, true);
    const uncompressedSize = view.getUint32(i + 24, true);
    const nameLen = view.getUint16(i + 28, true);
    const extraLen = view.getUint16(i + 30, true);
    const commentLen = view.getUint16(i + 32, true);
    const offset = view.getUint32(i + 42, true);

    const nameStart = i + CD_FIXED_LEN;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > tail.length) continue;

    // ZIP file names are UTF-8 when bit 11 of the flags is set, CP437 otherwise;
    // the members we read are ASCII either way, and a decode error must not
    // abort the scan.
    const name = new TextDecoder('utf-8', { fatal: false }).decode(tail.subarray(nameStart, nameEnd));
    out.push({ name, offset, compressedSize, uncompressedSize, method });

    // Jump past this record; -1 because the loop increments.
    i = nameEnd + extraLen + commentLen - 1;
  }

  return out;
}

/** Sentinel the ZIP format uses for "the real value is in a Zip64 extra field". */
const ZIP64_SENTINEL = 0xffffffff;

export interface ZipRangeOptions {
  userAgent: string;
  /** Text encoding of the member. The SEC's ADV files are latin-1, not UTF-8. */
  encoding?: string;
  /** Called before each request, so a caller can apply its own rate limit. */
  throttle?: () => Promise<void>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 600_000; // these members are 60–95 MB compressed

/**
 * Stream one ZIP member, decoded to text, in chunks.
 *
 * Returns false — never partial data — when the server ignores `Range` (a 200
 * where a 206 was asked for means the body is the whole 700 MB archive, not the
 * member), when the member is Zip64-sized, or when it is not deflate/stored.
 */
export async function streamZipMember(
  url: string,
  entry: ZipEntry,
  opts: ZipRangeOptions,
  onChunk: (text: string) => void,
): Promise<boolean> {
  if (entry.compressedSize === ZIP64_SENTINEL || entry.offset === ZIP64_SENTINEL) {
    return false;
  }
  if (entry.method !== 0 && entry.method !== 8) return false;

  // The local header repeats the name and may carry different extra fields, so
  // its true length is only known from the bytes themselves. Over-fetch by a
  // generous margin and skip the header once it has arrived.
  const HEADER_SLACK = 4096;
  const start = entry.offset;
  const end = entry.offset + HEADER_SLACK + entry.compressedSize - 1;

  await opts.throttle?.();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': opts.userAgent,
        Accept: '*/*',
        Range: `bytes=${start}-${end}`,
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    return false;
  }

  // 206 is the only acceptable answer: a 200 means the range was ignored and
  // the body is the entire archive, which must never be read as data.
  if (res.status !== 206 || !res.body) return false;

  const decoder = new TextDecoder(opts.encoding ?? 'utf-8');
  const inflate = entry.method === 8 ? createInflateRaw() : null;
  let failed = false;

  if (inflate) {
    inflate.on('data', (buf: Buffer) => onChunk(decoder.decode(buf, { stream: true })));
    inflate.on('error', () => {
      failed = true;
    });
  }

  const finished = inflate
    ? new Promise<void>((resolve) => {
        inflate.on('end', () => resolve());
        inflate.on('close', () => resolve());
        inflate.on('error', () => resolve());
      })
    : Promise.resolve();

  // Header bytes to discard before the compressed payload begins.
  let pending: Uint8Array | null = new Uint8Array(0);
  let skip = -1;
  let written = 0;

  /** Feed compressed bytes to the inflater, honouring backpressure: these
   *  members are up to 95 MB compressed, and writing faster than zlib drains
   *  would let its internal buffer grow without bound. */
  const push = async (bytes: Uint8Array): Promise<void> => {
    if (bytes.length === 0) return;
    if (written >= entry.compressedSize) return;
    const room = entry.compressedSize - written;
    const slice = bytes.length > room ? bytes.subarray(0, room) : bytes;
    written += slice.length;
    if (!inflate) {
      onChunk(decoder.decode(slice, { stream: true }));
      return;
    }
    if (!inflate.write(Buffer.from(slice))) {
      // 'error'/'close' as well as 'drain': a stream that dies mid-write never
      // drains, and waiting on 'drain' alone would hang the read forever.
      await new Promise<void>((resolve) => {
        const done = (): void => {
          inflate.off('drain', done);
          inflate.off('error', done);
          inflate.off('close', done);
          resolve();
        };
        inflate.once('drain', done);
        inflate.once('error', done);
        inflate.once('close', done);
      });
    }
  };

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    if (failed) break;

    if (skip < 0) {
      // Accumulate until the local header's name/extra lengths are readable.
      const merged = concat(pending ?? new Uint8Array(0), chunk);
      if (merged.length < LOCAL_FIXED_LEN) {
        pending = merged;
        continue;
      }
      const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);
      skip = LOCAL_FIXED_LEN + view.getUint16(26, true) + view.getUint16(28, true);
      if (merged.length < skip) {
        pending = merged;
        skip = -1;
        continue;
      }
      pending = null;
      await push(merged.subarray(skip));
      continue;
    }

    await push(chunk);
    if (written >= entry.compressedSize) break;
  }

  if (inflate) {
    inflate.end();
    await finished;
  }
  onChunk(decoder.decode());
  return !failed && written > 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Fetch the last `length` bytes of `url`, for the central directory. */
export async function fetchTail(
  url: string,
  length: number,
  opts: ZipRangeOptions,
): Promise<Uint8Array | null> {
  await opts.throttle?.();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': opts.userAgent,
        Accept: '*/*',
        Range: `bytes=-${length}`,
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (res.status !== 206) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
