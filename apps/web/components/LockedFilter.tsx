import { directoryParamLabel, type GatedEntity, type UnlockBy } from '@repo/api';

import { Button } from '@/components/ui';

/**
 * A directory filter this viewer may not use, in place of its control: the API
 * ignores the param (the field it matches on is withheld from them), so the
 * control says what opens it — signing in, or contributing. A crafted URL
 * still shows the unfiltered page.
 */
export function LockedFilter({
  entity,
  param,
  unlockBy,
  next,
}: {
  entity: GatedEntity;
  /** The filter param (`stage`, `status`, …) — `DirectoryPage.locked.filters`. */
  param: string;
  unlockBy: UnlockBy | undefined;
  /** Where sign-in returns to. */
  next: string;
}) {
  const label = directoryParamLabel(entity, param).toLowerCase();
  const contribute = unlockBy === 'contribute';
  return (
    <Button
      variant="outline"
      shape="box"
      size="sm"
      href={contribute ? '/contribute' : `/login?next=${encodeURIComponent(next)}`}
      className="self-center text-graphite-500"
    >
      {contribute ? `Contributors can filter by ${label}` : `Sign in to filter by ${label}`}
    </Button>
  );
}
