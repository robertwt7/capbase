import { DirectorySkeleton } from '@/components/skeletons';

import { PERSON_COLUMNS } from './columns';

export default function Loading() {
  return (
    <DirectorySkeleton
      title="People"
      label="people"
      // The "At several companies" pill toggle, then the sort select.
      controls={['h-9 w-44 rounded-full', 'w-[170px]']}
      cols={PERSON_COLUMNS}
      cells={['right', 'right', 'left']}
      lines={1}
      collapseAt={820}
    />
  );
}
