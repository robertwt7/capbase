import Link from 'next/link';

import { CompanyLogo } from '@/components/CompanyLogo';
import { Button, Card, Eyebrow, Stat } from '@/components/ui';
import { formatCount } from '@/lib/format';

/**
 * A signed-out viewer's page for an entity only the licensed partner records
 * (`partnerOnly` on the API response): name, public prose, counts and a sign-in
 * panel. Company and firm stubs with prose are indexable; the API decides.
 */
export function StubProfile({
  kind,
  name,
  domain,
  oneLiner,
  description,
  counts,
  next,
  back,
  claimHref,
}: {
  kind: 'Company' | 'Investor' | 'Fund' | 'Person';
  name: string;
  /** The logo domain, '' or null when it is withheld too. */
  domain?: string | null;
  oneLiner?: string;
  description?: string | null;
  counts: { label: string; value: number }[];
  /** Where sign-in returns to — this page. */
  next: string;
  back: { href: string; label: string };
  /** A company stub's "This is my company" entry (the claim page asks for sign-in itself). */
  claimHref?: string;
}) {
  return (
    <div className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8 pb-16">
      <Link
        href={back.href}
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← {back.label}
      </Link>
      <header className="flex items-center gap-6 border-b border-ink pt-7 pb-9">
        <CompanyLogo name={name} domain={domain ?? ''} size={72} />
        <div className="min-w-0">
          <Eyebrow>{kind}</Eyebrow>
          <h1 className="mt-2 font-display text-[clamp(1.875rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.035em] text-ink [overflow-wrap:anywhere]">
            {name}
          </h1>
          {oneLiner && (
            <p className="mt-3 max-w-[48ch] text-[17px] text-graphite-700 [overflow-wrap:anywhere]">
              {oneLiner}
            </p>
          )}
        </div>
      </header>
      {description && description !== oneLiner && (
        <section className="max-w-[70ch] py-9">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink">About</h2>
          <p className="mt-3 text-base leading-[1.65] text-graphite-900 [overflow-wrap:anywhere]">
            {description}
          </p>
        </section>
      )}
      {counts.length > 0 && (
        <section className="flex flex-wrap gap-x-16 gap-y-3.5 border-b border-line py-8">
          {counts.map((c) => (
            <Stat key={c.label} label={c.label} value={formatCount(c.value)} />
          ))}
        </section>
      )}
      <Card data-nosnippet className="mt-8 flex max-w-[560px] flex-col items-start gap-3 p-6">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">
          Sign in to see more
        </h2>
        <p className="font-sans text-sm leading-relaxed text-graphite-700">
          {kind === 'Company'
            ? 'Funding rounds, investors and people for this company come from licensed data. A free account shows the first rows of each section; an approved contribution opens every profile in full.'
            : kind === 'Investor'
              ? 'Portfolio companies, funds and people for this firm come from licensed data. A free account shows the first rows of each section; an approved contribution opens every profile in full.'
              : 'This profile comes from licensed data. A free account shows the first rows of each section; an approved contribution opens every profile in full.'}
        </p>
        <Button variant="primary" shape="pill" size="sm" href={`/login?next=${encodeURIComponent(next)}`}>
          Sign in
        </Button>
      </Card>
      {claimHref && (
        <p className="mt-6 font-mono text-xs text-graphite-500">
          Work at {name}?{' '}
          <Link
            href={claimHref}
            className="underline underline-offset-[3px] transition-colors hover:text-ink"
          >
            This is my company
          </Link>
        </p>
      )}
    </div>
  );
}
