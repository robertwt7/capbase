'use client';

import { canViewCompanyHistory, type Role } from '@repo/api';
import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui';

import { confirmCurrentAction } from './actions';

/** The profile's secondary links (Compare, History) folded into one menu,
    for the phone layout where they no longer fit beside the primary action.
    The page shows the plain buttons instead above that width. */
export function MoreActionsMenu({
  slug,
  role,
  className,
  viewerClaim,
}: {
  slug: string;
  role?: Role;
  className?: string;
  /** The viewer's active claim: adds "Confirm still current" (disabled once done today). */
  viewerClaim?: { canConfirm: boolean } | null;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          shape="pill"
          size="sm"
          aria-label="More actions"
          className={className}
        >
          <Ellipsis aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/compare?companies=${slug}`}>Compare</Link>
        </DropdownMenuItem>
        {canViewCompanyHistory(role) && (
          <DropdownMenuItem asChild>
            <Link href={`/companies/${slug}/history`}>History</Link>
          </DropdownMenuItem>
        )}
        {viewerClaim ? (
          <DropdownMenuItem
            disabled={!viewerClaim.canConfirm || pending}
            onSelect={() =>
              startTransition(async () => {
                await confirmCurrentAction(slug);
              })
            }
          >
            {viewerClaim.canConfirm ? 'Confirm still current' : 'Confirmed today'}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
