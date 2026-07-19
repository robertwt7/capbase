import { requireUser } from '../../lib/auth';
import { CompanyForm } from './CompanyForm';

export const metadata = {
  title: 'Contribute a company',
  robots: { index: false, follow: false },
};

export default async function ContributePage() {
  await requireUser('/contribute');
  return <CompanyForm />;
}
