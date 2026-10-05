import { COMPANY_COLUMNS } from '@/components/CompanyTable';
import { DirectorySkeleton } from '@/components/skeletons';

export default function Loading() {
  return (
    <DirectorySkeleton
      title="Companies"
      label="companies"
      controls={['w-[170px]', 'w-[150px]', 'w-[150px]', 'w-[170px]']}
      cols={COMPANY_COLUMNS}
      cells={['left', 'right', 'right']}
      logo
      collapseAt={700}
    />
  );
}
