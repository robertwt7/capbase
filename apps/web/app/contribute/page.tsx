import { VerifyEmailBanner } from '../../components/VerifyEmailBanner';
import { requireUser } from '../../lib/auth';
import { turnstileSiteKey } from '../../lib/turnstile';
import { CompanyForm } from './CompanyForm';

export const metadata = {
  title: 'Contribute a company',
  robots: { index: false, follow: false },
};

export default async function ContributePage() {
  const user = await requireUser('/contribute');
  return (
    <CompanyForm
      turnstileSiteKey={turnstileSiteKey()}
      notice={<VerifyEmailBanner user={user} className="mb-8" />}
    />
  );
}
