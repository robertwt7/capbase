'use client';

import type { Audience, PolicyOverrideMeta, SectionLevel } from '@repo/api';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui';
import { formatDay } from '@/lib/format';
import type { ActionResult } from '@/lib/validation/utils';

export const LEVEL_LABELS: Record<SectionLevel, string> = { hidden: 'Hidden', preview: 'Preview', full: 'Full' };
export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: 'Everyone',
  signedIn: 'Signed in',
  contributors: 'Contributors',
};

/** "Default", or who changed it and when — the row's mono meta line. */
export function OverrideMeta({ override }: { override: PolicyOverrideMeta | null }) {
  return (
    <span className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
      {override
        ? `Changed by ${override.updatedBy ?? 'a former admin'} · ${formatDay(override.updatedAt)}`
        : 'Default'}
    </span>
  );
}

/** Save, and — when the row is overridden — Reset to default. */
export function RowActions({
  saving,
  overridden,
  onReset,
}: {
  saving: boolean;
  overridden: boolean;
  onReset: () => Promise<ActionResult>;
}) {
  const [resetting, startReset] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant="primary" size="sm" type="submit" disabled={saving || resetting}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
      {overridden ? (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={saving || resetting}
          onClick={() =>
            startReset(async () => {
              const result = await onReset();
              setError(result.ok ? undefined : (result.formError ?? 'Could not reset.'));
            })
          }
        >
          {resetting ? 'Resetting…' : 'Reset to default'}
        </Button>
      ) : null}
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}
