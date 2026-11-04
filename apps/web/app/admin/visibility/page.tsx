import type { Metadata } from 'next';
import type { SectionEntity } from '@repo/api';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getVisibility } from '@/lib/admin';
import { requireAdmin } from '@/lib/auth';

import { FilterLink } from '../FilterLink';
import { FieldPolicyRow } from './FieldPolicyRow';
import { SectionPolicyRow } from './SectionPolicyRow';
import { WindowRow } from './WindowRow';

export const metadata: Metadata = { title: 'Visibility', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'company', label: 'Company' },
  { key: 'investor', label: 'Investor' },
  { key: 'fund', label: 'Fund' },
  { key: 'person', label: 'Person' },
  { key: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** A key that changes whenever the row's stored state does, so a saved or
 *  reset row remounts with its new values as the form defaults. */
const rowKey = (id: string, current: unknown, updatedAt: string | undefined) =>
  `${id}:${updatedAt ?? 'default'}:${JSON.stringify(current)}`;

export default async function VisibilityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin();
  const { tab: raw } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : 'company';
  const view = await getVisibility();
  const sections = view.sections.filter((s) => s.entity === (tab as SectionEntity));
  const fields = view.fields.filter((f) => f.entity === tab);

  return (
    <PageContainer className="py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">Visibility</h1>
        <div className="mt-2 flex max-w-[72ch] flex-col gap-2 text-[15px] text-graphite-700">
          <p>
            What each audience sees of a profile. <strong className="text-ink">Signed out</strong> is
            anyone, search engines included; <strong className="text-ink">signed in</strong> is an
            account without a live contribution; <strong className="text-ink">contributed</strong> is an
            account with an approved contribution inside the window, and every contributor-role
            account. Admins always see everything.
          </p>
          <p>
            Counts are always public. Partner-only pages, and their absence from signed-out directories,
            search and the sitemap, are fixed. The company history page is unaffected: contributors and
            admins see every revision there, whatever is hidden here.
          </p>
          <p>
            A setting for <strong className="text-ink">signed out</strong>{' '}is what search engines index.
            Profiles change on their next load; signed-out directories within a minute. A field limited to
            contributors makes each signed-in directory read look up the viewer&apos;s contributions.
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 pt-6" aria-label="Settings group">
        {TABS.map((t) => (
          <FilterLink key={t.key} href={`/admin/visibility?tab=${t.key}`} active={t.key === tab}>
            {t.label}
          </FilterLink>
        ))}
      </nav>

      {tab === 'settings' ? (
        <section className="pt-8">
          <SectionHeader title="Settings" size="md" className="mb-5" />
          <WindowRow
            key={rowKey('window', view.contributionWindowDays.current, view.contributionWindowDays.override?.updatedAt)}
            setting={view.contributionWindowDays}
          />
        </section>
      ) : (
        <>
          <section className="pt-8">
            <SectionHeader title="Sections" note={`${sections.length} on this page`} size="md" className="mb-5" />
            <ol className="flex flex-col gap-4">
              {sections.map((row) => (
                <li key={rowKey(row.section, row.current, row.override?.updatedAt)}>
                  <SectionPolicyRow row={row} />
                </li>
              ))}
            </ol>
          </section>
          {fields.length > 0 ? (
            <section className="pt-10">
              <SectionHeader title="Facts" note={`${fields.length} fields`} size="md" className="mb-5" />
              <ol className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
                {fields.map((row) => (
                  <li key={rowKey(`${row.entity}.${row.field}`, row.current, row.override?.updatedAt)}>
                    <FieldPolicyRow row={row} />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
