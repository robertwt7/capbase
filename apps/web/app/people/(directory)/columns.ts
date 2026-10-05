// Shared by PeopleDirectory and the loading skeleton. A plain module, not the
// 'use client' component: a server component importing a constant from a client
// module receives a client reference, not the string.

// Every row is its own grid, so no track may size to its content (`auto`) —
// that would give each row different column edges.
export const PERSON_COLUMNS =
  'grid-cols-[minmax(0,1.4fr)_5rem_6.5rem_minmax(0,2fr)] gap-x-8 max-[820px]:grid-cols-1';
