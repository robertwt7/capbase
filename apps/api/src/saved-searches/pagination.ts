import { BadRequestException } from '@nestjs/common';
export function pageLimit(raw?: string): number {
  if (raw === undefined) return 25;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100)
    throw new BadRequestException('limit must be 1–100');
  return Number(raw);
}
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString(
    'base64url',
  );
}
export function decodeCursor(raw?: string): { at: Date; id: string } | null {
  if (!raw) return null;
  try {
    if (raw.length > 500) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      typeof value[1] !== 'string' ||
      !value[1] ||
      value[1].length > 100 ||
      !Number.isFinite(Date.parse(value[0]))
    )
      throw new Error();
    return { at: new Date(value[0]), id: value[1] };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
