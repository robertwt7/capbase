import type { MonitorState } from './saved-search';
import type { UnlockBy } from './visibility';
import type { Stage } from './company';

/** A watchlisted company, summarised for the profile list. */
export interface SavedCompanyItem {
  slug: string;
  name: string;
  domain: string;
  oneLiner: string;
  stage: Stage;
  totalRaisedUsd: number;
  masked?: string[];
  maskedUnlock?: Record<string, UnlockBy>;
  monitor?: MonitorState;
  savedAt: string; // ISO timestamp
}

export interface SavedStatus {
  saved: boolean;
}
