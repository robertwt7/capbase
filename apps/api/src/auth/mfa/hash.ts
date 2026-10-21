import { createHash } from 'node:crypto';

/** sha256 hex of a single-use secret (reset/verification links, challenges, recovery codes).
 *  Only this is stored, so a database read never yields a usable token. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
