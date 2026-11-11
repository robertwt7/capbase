import type { CursorPage, MonitorUpdate } from '@repo/api';
import { featureFetch } from './saved-searches';
export const getUpdates = (cursor?: string) =>
  featureFetch<CursorPage<MonitorUpdate>>(
    `/auth/me/updates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
