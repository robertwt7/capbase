// Shared by InvestorDirectory and the loading skeleton. A plain module, not the
// 'use client' component: a server component importing a constant from a client
// module receives a client reference, not the string.

// Every row is its own grid, so no track may size to its content (`auto`, or a
// bare `fr`, whose minimum is min-content) — that would give each row different
// column edges and pull the sectors column off its header.
export const INVESTOR_COLUMNS =
  'grid-cols-[minmax(0,1.4fr)_6rem_minmax(0,1.2fr)_minmax(0,1.6fr)] gap-x-8 max-[820px]:grid-cols-1';
