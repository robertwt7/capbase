import Link from 'next/link';

import { CompanyLogo } from '@/components/CompanyLogo';
import { Button, Card, Eyebrow, Stat } from '@/components/ui';
import { formatCount } from '@/lib/format';

/**
 * A signed-out viewer's page for an entity only the licensed partner records
 * (`partnerOnly` on the API response): the name, the public counts, and one
 * panel inviting a sign-in. The API sends nothing more, so there is nothing
 * more to render — and the page is `noindex` (its `generateMetadata` says so).
 */
export function StubProfile({
  kind,
  name,
  domain,
  counts,
  next,
  back,
}: {
  kind: 'Company' | 'Investor' | 'Fund' | 'Person';
  name: string;
  /** The logo domain, '' or null when it is withheld too. */
  domain?: string | null;
  counts: { label: string; value: number }[];
  /** Where sign-in returns to — this page. */
  next: string;
  back: { href: string; label: string };
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
          <h1 className="mt-2 font-display text-[clamp(1.875rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.035em] text-ink">
            {name}
          </h1>
        </div>
      </header>
      {counts.length > 0 && (
        <section className="flex flex-wrap gap-x-16 gap-y-3.5 border-b border-line py-8">
          {counts.map((c) => (
            <Stat key={c.label} label={c.label} value={formatCount(c.value)} />
          ))}
        </section>
      )}
      <Card data-nosnippet className="mt-8 flex max-w-[560px] flex-col items-start gap-3 p-6">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">
          Sign in to view this profile
        </h2>
        <p className="font-sans text-sm leading-relaxed text-graphite-700">
          This profile comes from licensed data, which is open to anyone with a free account.
        </p>
        <Button variant="primary" shape="pill" size="sm" href={`/login?next=${encodeURIComponent(next)}`}>
          Sign in
        </Button>
      </Card>
    </div>
  );
}
