// Shared by FundDirectory and the loading skeleton. A plain module, not the
// 'use client' component: a server component importing a constant from a client
// module receives a client reference, not the string.

// Every row is its own grid, so no track may size to its content (`auto`, or a
// bare `fr`, whose minimum is min-content) — that would give each row different
// column edges. Fixed tracks fit the widest value ("Securitized asset",
// "Undisclosed"); the text tracks share the rest.
export const FUND_COLUMNS =
  'grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_10rem_4.5rem_7rem] gap-x-8 max-[820px]:grid-cols-1';
