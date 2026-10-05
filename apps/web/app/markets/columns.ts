// Shared by MarketTable and the loading skeleton. A plain module, not the
// 'use client' component: a server component importing a constant from a client
// module receives a client reference, not the string.
export const MARKET_COLUMNS = 'grid-cols-[minmax(0,1.6fr)_1fr_0.8fr_1.2fr_0.8fr_0.9fr] gap-5';
