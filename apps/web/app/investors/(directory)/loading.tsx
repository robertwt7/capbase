import { DirectorySkeleton } from '@/components/skeletons';

import { INVESTOR_COLUMNS } from './columns';

export default function Loading() {
  return (
    <DirectorySkeleton
      title="Investors"
      label="investors"
      controls={['w-[170px]', 'w-[170px]']}
      cols={INVESTOR_COLUMNS}
      cells={['right', 'left', 'left']}
      collapseAt={820}
    />
  );
}
