'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui';

/** The profile's secondary links (Compare, History) folded into one menu,
    for the phone layout where they no longer fit beside the primary action.
    The page shows the plain buttons instead above that width. */
export function MoreActionsMenu({ slug, className }: { slug: string; className?: string }) {
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
        <DropdownMenuItem asChild>
          <Link href={`/companies/${slug}/history`}>History</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
