import { DirectorySkeleton } from '@/components/skeletons';

import { FUND_COLUMNS } from './columns';

export default function Loading() {
  return (
    <DirectorySkeleton
      title="Funds"
      label="funds"
      controls={['w-[190px]', 'w-[170px]']}
      cols={FUND_COLUMNS}
      cells={['left', 'left', 'right', 'right']}
      lines={1}
      collapseAt={820}
    />
  );
}
