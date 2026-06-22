This is a monorepo using TurboRepoJS, all using Typescript
There is NextJS app and NestJS app for frontend and backend. There should also be a job to ingest data for rounding funds for companies. This is aiming to be an open source alternative of Crunchbase and Pitchbook

## Frontend (apps/web)

Next.js 16 (App Router, React 19). Styling is plain CSS Modules + design tokens in
`app/globals.css` — there is no Tailwind. Keep that convention; do not add a CSS
framework without being asked.

### Design system — "monochrome terminal ledger"

The interface is deliberately monochrome (graphite ramp) so that company logos are
the only color on screen. When adding UI, hold this line: no accent colors, no
gradients. Emphasis comes from weight, size, and the mono numerals — not hue.

- Tokens live in `app/globals.css` (`:root`). Use `--ink`, `--paper`, `--surface`,
  the `--graphite-*` ramp, and `--line`. Never hardcode hex values in components.
- Type roles (loaded via `next/font/google` in `app/layout.tsx`):
  - `--font-display` → Archivo. Headlines, company names, big figures.
  - `--font-body` → IBM Plex Sans. Body text and labels.
  - `--font-mono` → IBM Plex Mono. Every financial figure / number, tabular.
- All money/number formatting goes through `lib/format.ts` (`formatUsd`,
  `formatCount`, `formatDate`, `signedPct`). Don't format inline.
- The signature element is the **Funding Ladder** (`components/FundingLadder.tsx`):
  rounds as a vertical ledger with bar widths encoding round size. Keep it as the
  one bold element; surrounding sections stay quiet.

### Data

`lib/data.ts` holds typed mock data (companies, rounds, investors, people,
acquisitions, exits, diversity, market stats) — figures are illustrative, not real.
This is the seam for the real API: replace `getCompanies` / `getCompany` with calls
to the NestJS app, keeping the exported types. Company logos resolve from `domain`
via Clearbit in `components/CompanyLogo.tsx`, with a monogram fallback.

### Routes

- `/` — landing: hero, market tape, sector cards, company directory table.
- `/companies/[slug]` — full company profile (funding ladder, investors, people,
  acquisitions, exits, diversity, financials). Missing sections render empty states
  that invite contribution (open-source angle).

Run the web app with `yarn dev` (it serves on port 3001).
