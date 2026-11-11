'use client';
import { useState, useTransition } from 'react';
import type { MonitorState } from '@repo/api';
import { Button, FormError } from '@/components/ui';
import { setMonitoringAction } from './monitoring-actions';
export function MonitoringToggle({
  kind,
  id,
  monitor,
}: {
  kind: 'search' | 'company';
  id: string;
  monitor: MonitorState;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [changed, setChanged] = useState<MonitorState | null>(null);
  const state = changed ?? monitor;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
      <span aria-live="polite">
        {!state.enabled
          ? 'Monitoring off'
          : state.status === 'baselining'
            ? 'Preparing…'
            : state.status === 'unavailable'
              ? 'Paused: this filter is not available'
              : 'Monitoring on'}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const result = await setMonitoringAction(kind, id, !state.enabled);
            if (result.ok)
              setChanged({ enabled: result.enabled, status: result.status });
            else setError(result.formError);
          })
        }
      >
        {pending
          ? 'Saving…'
          : state.enabled
            ? 'Turn monitoring off'
            : 'Turn monitoring on'}
      </Button>
      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
