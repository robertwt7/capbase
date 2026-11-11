import type { MyCompanyClaim } from '@repo/api';

/** One claim's state in words. Client-safe (no server imports). */
export function claimStatusLabel(claim: Pick<MyCompanyClaim, 'status' | 'endReason'>): string {
  switch (claim.status) {
    case 'active':
      return 'Verified representative';
    case 'pending':
      return 'Awaiting review';
    case 'suspended':
      return "Paused — the company's domain changed";
    case 'ended':
      switch (claim.endReason) {
        case 'withdrawn':
          return 'Withdrawn';
        case 'revoked':
          return 'Ended by a moderator';
        case 'rejected':
          return 'Not approved';
        default:
          return 'Ended';
      }
  }
}

/** How the claim was (or is being) made. */
export function claimMethodLabel(claim: Pick<MyCompanyClaim, 'method' | 'email'>): string {
  return claim.method === 'EMAIL'
    ? `Work email${claim.email ? ` · ${claim.email}` : ''}`
    : 'Request for review';
}
