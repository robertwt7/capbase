import { requireUser } from '../../lib/auth';
import { CompanyForm } from './CompanyForm';

export default async function ContributePage() {
  await requireUser('/contribute');
  return <CompanyForm />;
}
