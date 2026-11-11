export const SAVED_SEARCH_NAME_MAX = 100;
export const SAVED_SEARCH_PARAMS_MAX = 2000;
export type MonitorStatus = 'baselining' | 'active' | 'unavailable';
export interface MonitorState {
  enabled: boolean;
  status: MonitorStatus | null;
}
export interface SavedSearchItem {
  id: string;
  name: string;
  params: string;
  runnable: boolean;
  createdAt: string;
  monitor: MonitorState;
}
export interface SaveSearchInput {
  name: string;
  params: string;
}
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MonitorUpdate {
  id: string;
  kind: 'match' | 'funding';
  company: import('./company').Company;
  search: { name: string; path: string } | null;
  round: import('./company').FundingRound | null;
  observedAt: string;
}
