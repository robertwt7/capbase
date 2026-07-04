'use client';

import Link from 'next/link';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui';

import { CONTRIBUTION_TYPES, TYPE_LABELS } from './contribute/types';

/** Single entry point into the contribution hub: one dropdown listing every
    child entity type. Auth is handled by the hub page itself (login redirect). */
export function ProposeChangeMenu({ slug }: { slug: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" shape="pill" size="sm">
          Propose a change <span aria-hidden>▾</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {CONTRIBUTION_TYPES.map((type) => (
          <DropdownMenuItem key={type} asChild>
            <Link href={`/companies/${slug}/contribute?type=${type}`}>{TYPE_LABELS[type]}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
