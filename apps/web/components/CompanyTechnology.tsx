import Link from 'next/link';
import type { Citation as CitationRow, Company, CompanyAccess, GateView } from '@repo/api';

import { AdminOnlyBadge } from '@/components/AdminOnlyBadge';
import { Citation } from '@/components/Citation';
import { LockedSection } from '@/components/LockedSection';
import { SectionHeader } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { sectionView } from '@/lib/gate';

const outbound = 'text-ink underline underline-offset-[3px] hover:text-graphite-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink';

/** Evidence from the public homepage, intentionally separate from product infrastructure. */
export function CompanyTechnology({
  company,
  access,
  gate,
  citations,
}: {
  company: Company;
  access: CompanyAccess;
  /** The detail response's section views (`companyTechnologies`, `companyApps`). */
  gate: GateView | undefined;
  citations: CitationRow[];
}) {
  const techView = sectionView({ gate }, 'companyTechnologies');
  const appView = sectionView({ gate }, 'companyApps');
  const technologies = company.companyTechnologies ?? [];
  const apps = company.companyApps ?? [];
  if (!technologies.length && !apps.length) return null;
  const next = `/companies/${company.slug}`;
  const lock = { access, next, contributeHref: `${next}/contribute`, placeholder: 'row' as const };

  return (
    <section className="border-t border-line py-8">
      <SectionHeader title="Technology" size="md" className="mb-3 border-b-0 pb-0" />
      <p className="max-w-[70ch] text-sm leading-relaxed text-graphite-700">
        Public website signals observed on the company&apos;s homepage. These do not describe its
        complete internal software or product infrastructure.{' '}
        <Link href="/data#website-technologies" className={outbound}>How we collect this</Link>
      </p>
      {technologies.length > 0 && (
        <div className="mt-6">
          <h3 className="font-display text-base font-semibold text-ink">
            Website technologies
            <AdminOnlyBadge view={techView} className="ml-3 align-middle" />
          </h3>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {technologies.map((technology) => (
              <li key={technology.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-1 py-3 max-[600px]:grid-cols-1">
                <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
                  <a href={technology.vendorUrl} target="_blank" rel="noopener noreferrer" className={outbound}>
                    {technology.name}
                  </a>
                  <Citation citations={citations} entityId={technology.id} />
                  <span className="ml-2 text-xs text-graphite-500">{technology.category}</span>
                </div>
                <span className="font-mono text-xs text-graphite-500">
                  Observed on <time dateTime={technology.lastSeenAt}>{formatDate(technology.lastSeenAt)}</time>
                </span>
                <a href={technology.evidenceUrl} target="_blank" rel="noopener noreferrer"
                  title={technology.evidence} aria-label={`${technology.name}: website evidence`}
                  className={`${outbound} w-fit text-xs`}>Website evidence</a>
              </li>
            ))}
          </ul>
          <LockedSection {...lock} view={techView} shown={technologies.length}
            total={access.totals.companyTechnologies ?? technologies.length} noun="website technologies" />
        </div>
      )}
      {apps.length > 0 && (
        <div className="mt-6">
          <h3 className="font-display text-base font-semibold text-ink">
            Mobile apps
            <AdminOnlyBadge view={appView} className="ml-3 align-middle" />
          </h3>
          <p className="mt-2 text-sm text-graphite-700">Verified store links from the company&apos;s website.</p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {apps.map((app) => (
              <li key={app.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-5 gap-y-1 py-3">
                <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                  <a href={app.storeUrl} target="_blank" rel="noopener noreferrer" className={outbound}>
                    {app.store === 'APPLE' ? 'App Store' : 'Google Play'} · {app.appId}
                  </a>
                  <Citation citations={citations} entityId={app.id} />
                </span>
                <span className="font-mono text-xs text-graphite-500">
                  Observed on <time dateTime={app.lastSeenAt}>{formatDate(app.lastSeenAt)}</time>
                </span>
                <a href={app.evidenceUrl} target="_blank" rel="noopener noreferrer"
                  aria-label={`${app.appId}: website evidence`} className={`${outbound} w-full text-xs`}>Website evidence</a>
              </li>
            ))}
          </ul>
          <LockedSection {...lock} view={appView} shown={apps.length}
            total={access.totals.companyApps ?? apps.length} noun="mobile apps" />
        </div>
      )}
      <p className="mt-4 text-xs text-graphite-500">
        Spotted an incorrect association?{' '}
        <Link href={`/report/company/${company.slug}`} className={outbound}>Report an issue</Link>.
      </p>
    </section>
  );
}
