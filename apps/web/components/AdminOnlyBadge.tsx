import type { SectionView } from '@repo/api';

import { Badge } from '@/components/ui';

/** The tag an admin sees on a section switched off for every visitor
 *  (`/admin/visibility`). Renders nothing for anyone else. */
export function AdminOnlyBadge({ view, className }: { view: SectionView | undefined; className?: string }) {
  if (!view?.adminOnly) return null;
  return (
    <Badge variant="box" mono className={className}>
      Hidden from visitors
    </Badge>
  );
}
