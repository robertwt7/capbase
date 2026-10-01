import type { Metadata } from 'next';

import { Button, EmptyState, Eyebrow, PageContainer } from '@/components/ui';

export const metadata: Metadata = { title: 'Not found', robots: { index: false } };

export default function NotFound() {
  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <Eyebrow>404</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
        Nothing on this page of the ledger
      </h1>
      <EmptyState
        className="mt-7 max-w-[70ch]"
        action={
          <div className="flex flex-wrap gap-2">
            <Button href="/companies" variant="primary" size="sm">
              Browse companies
            </Button>
            <Button href="/contribute" variant="outline" size="sm">
              Add a company
            </Button>
          </div>
        }
      >
        The page you followed doesn&apos;t exist, or the record was removed. If a company is
        missing, you can add it — every submission is reviewed before it goes public.
      </EmptyState>
    </PageContainer>
  );
}
