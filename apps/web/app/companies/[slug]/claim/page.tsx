import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MyCompanyClaim } from '@repo/api';

import { Badge, Button, Card, PageContainer, SectionHeader } from '@/components/ui';
import { VerifyEmailBanner } from '@/components/VerifyEmailBanner';
import { requireUser } from '@/lib/auth';
import { claimMethodLabel, claimStatusLabel } from '@/lib/claim-status';
import { getCompanyClaim } from '@/lib/claims';
import { formatDay } from '@/lib/format';
import { turnstileSiteKey } from '@/lib/turnstile';

import { withdrawClaimAction } from './actions';
import { ClaimEmailForm, ClaimRequestForm } from './ClaimForms';

export const metadata = {
  title: 'Claim this company',
  robots: { index: false, follow: false },
};

/** "This is my company": prove a work address at the company's domain, or send a request for
 *  review. The company's stored domain is never shown here (it may be partner data). */
export default async function ClaimCompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/companies/${slug}/claim`);
  const view = await getCompanyClaim(slug);
  if (!view) notFound();
  const { company, claims } = view;

  const active = claims.find((c) => c.status === 'active');
  const openRequest = claims.find((c) => c.status === 'pending');
  const siteKey = turnstileSiteKey();
  const forms = { slug: company.slug, companyName: company.name, turnstileSiteKey: siteKey };

  return (
    <PageContainer className="pt-8 pb-20">
      <Link
        href={`/companies/${company.slug}`}
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← {company.name}
      </Link>

      <div className="mx-auto mt-8 w-full max-w-2xl">
        <SectionHeader
          title={`Represent ${company.name}`}
          note="Verified representatives"
          className="border-b-0 pb-0"
        />
        <p className="mt-2 text-sm text-graphite-500">
          Work at {company.name}? Verify it and the edits you send are marked as coming from the
          company, so a moderator decides them first, and the profile shows it is maintained by
          the company. Everything is still reviewed before it is published, and a claim never
          removes cited facts — to dispute one, use{' '}
          <Link
            href={`/report/company/${company.slug}`}
            className="text-ink underline underline-offset-[3px]"
          >
            Report an issue
          </Link>
          .
        </p>

        <VerifyEmailBanner user={user} className="mt-7" />

        {claims.length > 0 ? (
          <section aria-labelledby="your-claims" className="mt-7">
            <h2
              id="your-claims"
              className="font-mono text-xs tracking-[0.08em] text-graphite-500 uppercase"
            >
              Your claims on this company
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {claims.map((claim) => (
                <ClaimRow key={claim.id} claim={claim} slug={company.slug} />
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-7 flex flex-col gap-7">
          {active ? (
            <Card emphasis className="p-6">
              <p className="font-display text-lg font-bold tracking-tight text-ink">
                You represent {company.name}
              </p>
              <p className="mt-2 text-sm text-graphite-500">
                Edits you send from the profile are labelled as coming from a verified
                representative.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  shape="pill"
                  size="sm"
                  href={`/companies/${company.slug}/contribute?type=edit`}
                >
                  Propose an edit
                </Button>
                <Button variant="ghost" size="sm" href={`/companies/${company.slug}`}>
                  Back to the profile
                </Button>
              </div>
            </Card>
          ) : view.emailClaim ? (
            <>
              <section aria-labelledby="claim-email" className="flex flex-col gap-3">
                <h2 id="claim-email" className="font-display text-base font-bold text-ink">
                  Verify with your work email
                </h2>
                <ClaimEmailForm {...forms} />
              </section>
              {openRequest ? null : (
                <details className="group rounded-lg border border-line bg-surface">
                  <summary className="cursor-pointer px-6 py-4 font-sans text-sm font-semibold text-ink">
                    My address isn&apos;t at this company&apos;s domain
                  </summary>
                  <div className="px-6 pb-6">
                    <p className="mb-4 text-sm text-graphite-500">
                      Send a request instead. A moderator checks it by hand, so it takes longer.
                    </p>
                    <ClaimRequestForm {...forms} />
                  </div>
                </details>
              )}
            </>
          ) : openRequest ? null : (
            <section aria-labelledby="claim-request" className="flex flex-col gap-3">
              <h2 id="claim-request" className="font-display text-base font-bold text-ink">
                Send a request for review
              </h2>
              <p className="text-sm text-graphite-500">
                Email verification isn&apos;t available for this company. Tell us how you&apos;re
                connected to it and a moderator will check.
              </p>
              <ClaimRequestForm {...forms} />
            </section>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function ClaimRow({ claim, slug }: { claim: MyCompanyClaim; slug: string }) {
  const live = claim.status !== 'ended';
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Badge variant="pill" mono className={claim.status === 'active' ? 'border-ink text-ink' : undefined}>
          {claimStatusLabel(claim)}
        </Badge>
        <p className="mt-1.5 truncate font-sans text-[13px] text-graphite-700">
          {claimMethodLabel(claim)}
        </p>
        <p className="font-mono text-[11px] text-graphite-500 uppercase">
          {claim.verifiedAt
            ? `Verified ${formatDay(claim.verifiedAt)}`
            : `Sent ${formatDay(claim.createdAt)}`}
        </p>
      </div>
      {live ? (
        <form action={withdrawClaimAction.bind(null, claim.id, slug)}>
          <Button variant="outline" size="sm" type="submit">
            {claim.status === 'pending' ? 'Withdraw request' : 'Withdraw'}
          </Button>
        </form>
      ) : null}
    </li>
  );
}
