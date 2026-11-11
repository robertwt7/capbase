This is a monorepo using TurboRepoJS, all using Typescript. It is an open-source
alternative to Crunchbase and Pitchbook: crowdsourced company + funding data with
admin moderation, plus automated ingestion of public filings.

Workspaces:

- `apps/web` — Next.js 16 frontend (public site + `/admin` moderation portal).
- `apps/api` — NestJS REST API (auth, moderation, public reads).
- `apps/jobs` — NestJS worker that ingests public filings and bulk datasets (SEC
  Form D on a daily cron; Innovate UK + Companies House on an opt-in monthly cron;
  Form C, SBIR, Form S-1, Form ADV + its Schedule D funds, and Wikidata by hand).
- `packages/api` (`@repo/api`) — shared domain types consumed by every app.
- `packages/db` (`@repo/db`) — shared Prisma schema, migrations, seed, client.
- `packages/{ui,eslint-config,jest-config,typescript-config}` — shared tooling.

Postgres runs via the root `docker-compose.yml`. See the `Makefile` for the common
dev/prod commands (`make help`).

## Frontend (apps/web)

Next.js 16 (App Router, React 19). Styling is **Tailwind CSS v4 + shadcn/ui**, themed
to a monochrome design system. Tokens are declared in `app/globals.css` (`:root` for
the raw values, `@theme inline` to expose them as utilities); `lib/utils.ts` exports
`cn` (clsx + tailwind-merge). Style with Tailwind utilities and the `components/ui`
primitives — don't add CSS Module files for new UI. (One legacy CSS Module remains, for
the not-yet-redesigned `(account)` **profile** pages; the `(account)` auth
forms — login/register — now follow the RHF+zod + Tailwind pattern. Back-compat token
aliases `--font-body`/`--page-max`/`--page-pad` exist only for the remaining module and
will go when those routes are redesigned.)

### Design system — "parchment ledger"

The interface is strict single-hue monochrome on warm cream paper, like an aged
ledger book. Surfaces are **tonal**: `--paper` is the cream page ground and
`--surface` (cards, tables, inputs) is one soft step lighter on the same warm axis —
never pure white — so sheets blend into the ground and hairline borders do the
separating. The graphite ramp is tinted warm (taupe grays) so ink → paper is one
continuous hue. Company
logos are the only saturated color on screen. When adding UI, hold this line: no
accent colors, no gradients, no pure `#fff`. Emphasis comes from weight, size, and
the mono numerals — not hue. Bordered containers that sit on the page must carry
their own `bg-surface`; never rely on the page ground being near-white (it isn't
anymore).

- The ledger ramp is exposed as Tailwind colors via `@theme`: use `text-ink`,
  `bg-paper`, `bg-surface`, `text-graphite-{200..900}`, `border-line`, plus the shadcn
  semantic colors (`bg-primary`, `text-muted-foreground`, `border-border`, …) which all
  map onto the ramp. Never hardcode hex values. **The one sanctioned use of red is
  validation/error feedback** — `--destructive` / `text-destructive` (the `FormError`
  box, `FormMessage` field errors, and invalid-control borders/rings). Destructive
  *actions* (delete-style menu items) stay monochrome — emphasis is weight/border,
  never red. Everything else stays graphite.
- Type roles (next/font in `app/layout.tsx`, exposed as `@theme` font utilities):
  - `font-display` → Archivo. Headlines, company names, big figures.
  - `font-sans` (default `body`) → IBM Plex Sans. Body text.
  - `font-mono` → IBM Plex Mono. Every financial figure / number (tabular) **and**
    every meta label (uppercase, tracked) — the mono carries the "terminal" identity.
- All money/number formatting goes through `lib/format.ts` (`formatUsd`,
  `formatMoney(amount, currency)`, `formatCount`, `formatDate`, `signedPct`,
  `countryName`). Don't format inline. Countries render as **text, never flag emoji**
  (emoji are colour).
- The signature element is the **Funding Ladder** (`components/FundingLadder.tsx`):
  rounds as a vertical ledger with bar widths encoding round size. Keep it as the
  one bold element; surrounding sections stay quiet. A non-USD round (an Innovate UK
  grant) is labelled in its own currency (`£425K`) with `≈ $553K` beside the date;
  **bar widths always use `amountUsd`**, so rungs in two currencies stay comparable.
- Radii: `rounded-sm` 6px, `rounded-md` 10px, `rounded-lg` 12px, `rounded-full` for
  pills (set via `@theme`). Use them, don't hardcode pixel radii.

#### Components (`components/ui/`)

`Button`, `Card`, `Badge`, `Input`, `Textarea`, `Select`, `Checkbox`, `Label`, `Separator`, `Form`, `Sheet` are
**real shadcn/ui components** (CLI-generated, then re-themed monochrome onto the existing CSS
variables — no accent, no red destructive). Files are lowercase (`button.tsx`, `card.tsx`,
`badge.tsx`, …) per shadcn convention; the barrel `index.ts` re-exports the capitalised
public API (`Button`, `Card`, `Badge`, …). `components.json` is wired (`@/*` alias, new-york,
`cssVariables`); add more primitives with `npx shadcn@latest add <name>` then theme monochrome.
The generated files import the unified `radix-ui` package — rewrite those to the individual
`@radix-ui/react-*` packages (already deps) to stay consistent and avoid a redundant dep.

- **`Button`** — keeps the project API (not shadcn's default variants): `variant` `primary`
  (filled `bg-primary`) / `ghost` (chrome-less text) / `outline`; `shape` `pill` | `box`;
  `size` `sm` | `md`; `block`; renders `next/link` when given `href`, else a `<button>`. (cva.)
- **`Badge`** (was `Tag`) — `variant` `pill` | `box`, optional `mono` for the mono-uppercase
  meta treatment (via `badgeVariants`).
- **`Card`** — single-panel shadcn `Card` re-themed to `surface` + `border-line`; `emphasis`
  → `border-ink`. Padding comes from the caller's `className` (the `CardHeader`/`CardContent`
  sub-parts are exported but not yet used).
- **Form controls** — `Input` / `Textarea` (share one `controlClass` surface, exported from
  `input.tsx`), `Label`, and `Select` is shadcn's **Radix Select** (`SelectTrigger` /
  `SelectContent` / `SelectItem` / `SelectValue` / …). **`FormError`** (`FormError.tsx`) is
  the form-level (non-field) error box, used by both the RHF forms and the auth/admin pages.
- **`SectionHeader`**, **`Eyebrow`**, **`Stat`**, **`EmptyState`**, **`PageContainer`**,
  **`Skeleton`** / **`LoadingStatus`** stay bespoke Tailwind role components (no shadcn
  equivalent), as does `FundingLadder`.
- **`CompanyTable`** (`components/CompanyTable.tsx`) is the one company directory table
  (landing, `/companies`, `/markets/[sector]`). Its optional `locked={{ companies, overlay }}`
  appends rows rendered blurred, `inert` and `aria-hidden` (plain `<div>`s, not links) under
  an overlay — the landing page's contribution teaser. Reuse it for any other gated teaser
  rather than re-inlining a blur; there are no gradients, so the fade is the blur plus a
  translucent `bg-paper/45`.
- **The read gate's UI** (see Backend → the read gate). The web never re-derives the policy: it
  reads the per-viewer hints the API sends. **`LockedSection`** (`components/LockedSection.tsx`)
  is what every gated section renders after its visible rows. It takes the section's `view`
  (`sectionView(detail, key)` from `lib/gate.ts`, a lookup into `detail.gate.sections`) and
  renders nothing when `view.unlockBy` is null or `total <= shown`, else up to 3 blurred
  **text-free** `bg-graphite-200` placeholder shapes (`rung` | `card` | `row` | `terms`,
  `aria-hidden` + `inert`; fake copy would be indexed) under a `data-nosnippet` `Card`. Its copy
  keys on `view.unlockBy`: `signIn` "Sign in to see N …"; `contribute` signed out "… open to
  contributors: sign in, then any approved contribution unlocks …"; `contribute` signed in
  "Showing X of Y — any approved contribution unlocks …" (plus "Your access lapsed on …"), or,
  with `subject`, wording for a block withheld whole (fund terms, mandate, focus). The window
  number is `access.windowDays` (an admin setting — never a constant). A section whose view is
  **`disabled`** (switched off for every visitor) is not rendered at all — no block, no stat, no
  stub count, no funding summary line, no OG count; an admin still sees it, tagged
  **`AdminOnlyBadge`** ("Hidden from visitors", when `view.adminOnly`). A section renders its
  `EmptyState` **only when its total is 0** — a gated section with rows withheld is not empty.
  **`Masked`** / **`SignInChip`** / `isMasked` (`components/Masked.tsx`) render a field the API
  withheld (`entity.masked`, value blanked in the payload) as a mono chip: "Sign in", or
  "Contributors" (→ `/contribute`) when `entity.maskedUnlock[field]` is `contribute` (`unlockOf`;
  `unlockOfAny` for a node showing several fields). Never render a maskable value without asking
  (a blank total reads as "$0"); `link={false}` inside an element that is already a link
  (directory rows). **`LockedFilter`** (`components/LockedFilter.tsx`) stands in for a directory
  filter whose param is in the list response's `locked.filters` ("Sign in to filter by stage" /
  "Contributors can filter by stage", label from `FIELD_REGISTRY`); a sort in `locked.sorts` is
  left out of the sort Select. The API ignores both, so a crafted URL shows the unfiltered page. **`StubProfile`** is the signed-out page of a
  `partnerOnly` company/investor/fund/person (name, public prose where available, counts,
  one sign-in panel). Company/firm stubs with prose are indexable and in the sitemap;
  bare stubs, funds and people stay `noindex, follow`. The API decides. JSON-LD, metadata
  descriptions and OG images skip masked fields too.
- **`Sheet`** (Radix Dialog) backs the small-screen nav drawer in `components/SiteNav.tsx`
  (`PrimaryNav` + `MobileNav`, both setting `aria-current`).
- **`TurnstileField`** — the Cloudflare Turnstile challenge on register and every
  contribution form. Renders nothing without a site key. The key is read **server-side
  per request** (`lib/turnstile.ts`, env `TURNSTILE_SITE_KEY`) and passed down as a prop;
  the token travels through the server action to the API in the `x-turnstile-token`
  header. Tokens are single-use: forms remount the widget (`key`) after every attempt.
- **`HeaderSearch`** (`components/HeaderSearch.tsx`, client) — the header's search-as-you-type
  combobox. After a 300ms pause and 2+ characters (`SEARCH_MIN_CHARS`) it makes **one**
  `GET /api/search` call (the same-origin proxy → API `GET /search`) and shows up to 5
  companies / investors / people, each group ending in a "See all" link into its directory.
  Superseded requests are aborted. Rows are real `<Link prefetch={false}>`s (profile links);
  ↑/↓/Enter/Escape drive it and `/` focuses it from outside a text field. With nothing
  highlighted — or without JS — Enter still submits the plain form to `/companies?q=`.

- **Two-factor UI**: **`QrCode`** (`components/QrCode.tsx`) draws an otpauth URI as SVG rects in
  `fill-current text-ink` on `bg-surface` — never `toDataURL` (bakes in black on white).
  **`RecoveryCodesPanel`** is the one-time reveal (mono grid, Copy all, Download .txt).
  `components/auth/`: **`SecondFactorStep`** (the post-password step: "Use your passkey", a 6-digit
  code that auto-submits, "Use a recovery code instead"; `admin` makes completion refuse a
  non-admin) and **`TotpEnrollStep`** (QR + grouped key + code; settings and forced setup).
  `lib/webauthn.ts` maps browser ceremony errors (a cancel is quiet, never a red error).
  The sign-in step's API challenge lives in the httpOnly, `sameSite: strict` **`capbase_mfa`**
  cookie, the passwordless one in **`capbase_passkey`** (separate, so the email-field autofill a
  login page starts on load can't clobber a password sign-in's step); client JS never holds
  either. The route handlers share `lib/auth-proxy.ts` (`postToApi`, `failure` → `{ message,
  expired? }`, `finishLogin` sets the session and drops both step cookies).

**Landmarks:** the root layout owns the skip link and the single `<main id="content">`.
Pages render plain containers (`<div>` / `PageContainer`) — never their own `<main>`.

**Analytics consent:** GA loads only after opt-in (`components/ConsentBanner.tsx`,
`capbase_consent` cookie); with no `NEXT_PUBLIC_GA_ID` there is no banner at all.

**Build new UI from these primitives + Tailwind utilities.** Never re-inline a button,
badge, card, etc. — extend the primitive. Bespoke layout (grids, the Funding Ladder spine)
is just Tailwind utilities in the component/page, no CSS Modules.

#### Loading states

Every route is dynamic (the root layout reads the session cookie), so without a
`loading.tsx` a `<Link>` click waits for the whole server render. Every data route therefore
has one — a skeleton that `<Link>` prefetches and swaps in the same frame as the click:

- **Route groups scope the boundary.** A `loading.tsx` wraps its whole subtree, so each sits
  in a group with just its page: `(directory)` for `/companies`, `/investors`, `/people`,
  `/funds`; `(overview)` for `/markets`; `(profile)` for `/companies/[slug]` (so `history/`
  and `contribute/` don't flash the profile skeleton — `history/` has its own); `(home)` for
  `/`. Leaf segments (`/investors/[slug]`, `/people/[slug]`, `/markets/[sector]`) need no
  group. **Never add `app/loading.tsx`** — it would wrap every route.
- **Skeletons mirror the real geometry** (`components/skeletons.tsx`: `DirectorySkeleton`,
  `TableSkeleton`, `ProfileSkeleton`, `StatsSkeleton`): the same containers, the real static
  headings, and the real table grid strings, shared from a plain `columns.ts` next to each
  `'use client'` directory — a server component importing a constant from a client module
  gets a client reference, not the string. Blocks are `bg-graphite-200` and
  `motion-safe:animate-pulse` (globals.css shortens, not removes, animations under reduced
  motion), hidden from AT, with one `<LoadingStatus>` per view.
- **Directory filters are unaffected**: a searchParams-only change does not remount the
  segment, so typing keeps focus and the existing `useTransition` dim, never the skeleton.
- **The landing page streams** its stat strip, sectors and popular companies into separate
  `<Suspense>` boundaries (`app/(home)/sections.tsx`); `loading.tsx` is the same composition
  with every fallback showing. `AccessNote` and `PopularCompanies` share one featured draw
  through React `cache`.
- `PrimaryNav`/`MobileNav` links carry a `useLinkStatus` underline for a click that beats
  its prefetch.
- **Links to a company/investor/person profile set `prefetch={false}`.** A profile prefetch
  renders its `generateMetadata`, which fetches the full, uncached detail record — one API
  call per link in the viewport, ~25 per directory page. Without prefetch the click still
  streams the profile skeleton after one round trip. Directory, markets and home links
  prefetch normally: their loading boundary sits above every API call.
- **The accepted trade:** once the skeleton has streamed the status is fixed at 200, so a
  missing profile slug is a 200 with `noindex` (and the not-found title in the blocking head
  for HTML-limited bots like Bingbot, because profile `generateMetadata` calls `notFound()`
  too), and a merged slug is a client redirect plus a 0s meta refresh — for every crawler,
  not only Googlebot.

#### Forms — react-hook-form + zod

Forms use **react-hook-form** with **zod** validation (shadcn `Form` pattern):

- zod schemas live in `lib/validation/` (`company.ts`, `round.ts`), with a
  `*FormSchema`, `*FormDefaults`, and a `to*Input` mapper to the `@repo/api` payload.
  Form values are string-only; numeric fields validate as digit-strings and convert in
  the mapper. Aligns field names with `@repo/api` `Create*Input`.
- Client: `useForm({ resolver: zodResolver(schema), defaultValues })` inside `<Form>`,
  with the generic `TextField` / `TextareaField` / `SelectField` wrappers
  (`components/ui/fields.tsx`) — label + control + inline `FormMessage` per field.
  `SelectField` drives the Radix Select via the `FormField` `Controller` (`onValueChange`);
  pass `<SelectItem>` children and an optional `placeholder` for the empty state.
- Every contribution form ends with a `<SourceUrlField>` (`components/ui/`): an optional
  but always-prompted `sourceUrl`. Child contributions mint a whole-row `Citation` at
  submission; an edit proposal stores the URL on `ChangeProposal.sourceUrl` and
  `applyProposal` materialises **one citation per changed field** on approval.
  `<Citation>` (`components/Citation.tsx`) renders the marker — a mono bracketed
  publisher tag, or a muted em dash when a fact is uncited, so the two never look alike.
- …and then an **`<AttestationField>`** (`components/ui/`, a Radix `Checkbox`): the required
  "I have the right to share this…" box (Terms §4). Its `attested` value is **the one boolean
  in a form schema** — the shared `attestation` zod rule in `lib/validation/utils.ts` (must be
  `true`), `attested: false` in every `*FormDefaults`, passed through by every `to*Input`
  (`toProposalInput` puts it on the payload, never in `changes`). Every contribution DTO
  requires it with `@Equals(true)`; it is not persisted. A new contribution form must add all
  three pieces or the API answers 400.
- Server stays authoritative: the server action re-runs `schema.safeParse` (never trust
  the client), maps with `to*Input`, and returns an `ActionResult`
  (`{ ok } | { ok:false, formError?, fieldErrors? }`, see `lib/validation/utils.ts`).
  `applyServerErrors` pushes server `fieldErrors` back into RHF via `setError`.

### Data

`lib/data.ts` is the data seam. Its getters are **async** and fetch the live NestJS API
through `lib/api.ts` (server-only `API_URL` env, 60s ISR). List reads are **paginated
server-side**: `getCompanies`/`getInvestors` take a `CompanyListQuery`/`InvestorListQuery`
(q/filters/sort/page/pageSize, parsed leniently from `searchParams` by `lib/list-params.ts`)
and return `Paginated<T>` (`{ items, total, page, pageSize }` from `@repo/api`). Directory
pages are URL-driven: the client components only mirror filter state to the URL (debounced
`router.replace`, page resets on filter change) and render the page plus `<Pagination>`;
the server component refetches. Gated reads pass the session: **profile** getters
(`getCompanyDetail`, `getInvestor`, `getFund`, `getPerson`, `getCompanyHistory`) send the bearer
token when there is one and are always `no-store`; **directory** getters (`getCompanies`,
`getInvestors`, `getFunds`, `getPeople`, and the `app/api/search` proxy) send **no token signed
out** — so the 60s ISR entry stays shared by every signed-out visitor, crawlers included — and
token + `no-store` signed in (Next keys its fetch cache on headers, so the two never mix). The mock arrays in the file remain ONLY as an offline
fallback if the API is unreachable in local dev — they are illustrative, not real. Domain
types are re-exported from `@repo/api` (single source of truth). Company logos resolve from `domain` through the same-origin proxy
`app/api/logo/[domain]` (DuckDuckGo icons; Clearbit's API is gone) in `components/CompanyLogo.tsx`; the
monogram is always rendered underneath, so a missing logo never leaves an empty chip. The brand
logo is `components/Logo.tsx` (`Logo` lockup, `LogoMark` cap) — never re-draw it inline.

### Routes

- `/` — landing: hero, market tape, a three-step **How it works** (public-record profiles,
  names, links and counts are open; rounds, deal values, fund terms and licensed data need a free
  account, which shows a preview → contribute → an approved contribution unlocks every profile for
  the window, whose number streams in from the featured read's `access.windowDays` (`WindowDays`;
  the loading shell says "a rolling window")), sector cards, and
  **Popular companies**: a fresh random draw per visit from `GET /companies/featured` (the API
  scores a 120-company pool on saves, named investors, recent rounds and a known valuation,
  caches it 15 min, and shuffles per call). A locked viewer sees the bottom half blurred
  (`CompanyTable`'s `locked` prop) under an "Unlock by contributing accepted data" panel;
  the featured response carries the viewer's `access` (optional JWT, like the detail read) and
  lifts it for unlocked users/admins. The gate rule itself is `UsersService.accessFor` — the one
  definition the profile detail, `/auth/me/contributions` and the featured read all use.
- `/companies` — the company directory and screener (`CompanyDirectory.tsx`). One `CompanyListQuery`
  state mirrors the URL: typing in the search box `router.replace`s (debounced); every committed
  change (a select, the **Filters** sheet's Apply, a chip's ×, "Clear filters") `router.push`es, so
  Back steps through filter states; every change drops `page`. When the URL changes from outside
  (Back/Forward, a deep link, a pagination link) the controls reset from it, adjusted during render
  (`seen`/`written` keys) — never from a URL this component just wrote. The **Filters** sheet
  (`ScreenSheet.tsx`, RHF + zod `lib/validation/screen.ts`, `parseMoneyInput` reads `5M`/`500k`)
  holds the scale ranges, one matching **financing** (window, kind, round size), an **investor**
  (`InvestorPicker`, a combobox on `/api/search`'s investors, stores the slug; Escape closes the list,
  not the sheet) with "any recorded link" / "on the matching financing", and the optional columns.
  **Active chips** (`ActiveFilters.tsx`, `screenChips`) list each applied criterion; a param in
  `locked.filters`/`locked.disabled` never gets a chip. `?cols=country,founded,headcount` adds
  `CompanyTable` columns (`companyColumns(extra, financing)` — literal track strings; the default call
  is `COMPANY_COLUMNS`, unchanged for the landing/markets tables and skeletons) and is a view
  preference ("Clear filters" keeps it). When financing criteria applied, a **Financing** column shows
  `screen.matches[slug]` (label, kind, date, amount in its currency `≈ $`, a link-free `<Citation
  link={false}>`, since the row is already a link). A hand-edited URL never 400s: the web parses the
  screening params with the shared lenient `parseCompanyScreen` (an inverted pair drops both bounds,
  `roundWithin` beats fixed dates, `investorOn` without `investor` is dropped).
- `/companies/[slug]` — full company profile (funding ladder, investors, people,
  acquisitions, exits, diversity, financials). Missing sections render empty states
  that invite contribution (open-source angle). Each section is its gated rows plus a
  `LockedSection`; a **funding summary line** (recorded round count, the API's `latestRound`,
  recorded total) sits under the Funding rounds header for everyone, even when the ladder itself is
  gated. An unknown headcount and a zero raised total render as an em dash, never "0"/"$0" (zero
  means every amount was undisclosed, or grants only). The **Investors** section is ordered by
  rounds recorded (then name), so a locked preview shows the most active backers, and each row
  shows the **linked firm's** name (the holding's stored name only when it links to no approved
  firm — the admin queue keeps the submitted name); the line reads "First round: X · N rounds
  recorded" ("First round undisclosed" for a generic round name), never "since" or "lead".
- `/funds` — fund directory (URL-driven filters, same pattern as companies): search,
  strategy and status filters, sort by size/vintage/name, `?manager=<slug>` scoping. **Sorted
  by size by default** (`Fund.sizeUsd` = gross assets, else capital closed — the figure the
  row shows) — AngelList-style SPV platforms report tens of thousands of near-empty funds and
  would otherwise own every page. `/funds/[slug]` — fund page (leaf segment, own
  `loading.tsx`): manager, strategy/status, vintage, size/target/hard cap, launch and close
  dates, terms (fee, carry, hurdle, target IRR; `formatPct`), a metrics table and the largest
  LP commitments. `noindex` unless `fundIndexable` (`@repo/api` `indexing.ts`): a commitment,
  a size, a target, a final close or a fee (read off the stored row, never a partner-only fund).
  Gated (defaults): metrics and LP commitments are `members` (`metricCount`/`commitmentCount`
  are public), the terms block and close dates are `contributors` — the API nulls them and sets
  `termsHidden` only when there were terms to hide (and the block is not switched off), so a fund
  with none shows no Terms section (no false lock).
  Between the metric strip and Terms sit **Investment mandate** (Strategy, Industries, Verticals,
  Geographic focus, Geographic exposure — label lists through `FocusLabels`) and **Fund
  structure** (Domicile, Structure, Legal structure, the header's `Fact` styling), both from
  `components/FundMandateSection.tsx`, each with a "Reported as of …" line, rows and sections
  omitted when empty (never an `EmptyState`). The mandate is one block (`fundMandate`, `members`
  by default): signed out the API sends `mandate: null` + `mandateHidden` and the page shows
  one `LockedSection`; a stub sends neither. Never in the directory, search, metadata, JSON-LD or
  OG. `make fund-mandate-fixture` (`-remove`) loads synthetic mandates on four local funds.
  Signed out, the directory's status filter (a partner-only column) is a `LockedFilter` ("Sign in
  to filter by status": `locked.filters` holds `status`) and the API ignores `?status=`.
- `/investors` — investor directory (URL-driven filters, same pattern as companies). The
  default sort reads the stored `Investor.holdingCount` (see Database), and so does each card's
  portfolio count (a live count joined ~27k holdings to `Company` per page). The card's
  portfolio sample is one `LATERAL … LIMIT` query (`portfolioSample`, on the
  `(investorId, externalSource, id)` index), signed out without partner holdings and with a
  partner-written company domain/sector blanked. `/investors/[slug]` — investor profile: facts, fund assets, funds (linked to their pages),
  **fund commitments** for a limited partner, portfolio grid (the `INVESTOR_PORTFOLIO_PREVIEW`
  largest by capital raised; count and sectors cover the whole portfolio), the firm's people
  (capped at `INVESTOR_PEOPLE_PREVIEW`, "N of M named"), or an empty state inviting a
  contribution. Every section is also capped by the gate (`gateLimit`; LP commitments are
  `members` by default) with a `LockedSection` against the public count. Between the metric strip
  and Funds sits **Investment focus** (`components/InvestorFocusSection.tsx`, partner data, a
  `members` block by default): one
  labelled `<dl>` grid per role — as a fund manager (Stages, Main strategy, Strategies,
  Industries, Verticals, Geographic exposure, Initial equity investment) and as a limited partner
  (Strategy preferences, Industries, Verticals, Geographic preferences, Typical fund commitment),
  with role subheadings only when both exist — each label list a `FocusLabels` disclosure (8
  shown, "Show all N", `aria-expanded`), ranges through `formatMoneyRange` ("From $1M", "Up to
  $10M"; a non-USD range in its own currency then a muted `≈ $…`), and a "Reported as of …" line
  per role. No focus on record → no section (never an `EmptyState`); withheld (`focus: null`,
  `focusCount > 0`) → a `LockedSection` with the `investorFocus` view; switched off → nothing,
  not even the lock. Never in
  metadata, JSON-LD, OG, directories or search. `make investor-focus-fixture` (`-remove`) loads
  synthetic focus on four local firms for checking the display. The detail read counts each relation with its own indexed `count()` — never
  Prisma's `_count`, which GROUP BYs the whole child table (~500 ms per profile at this size).
  The same rule holds for **lists**, a relation-count `orderBy` included: sorting `/people` on
  `roles: { _count }` cost 12.6 s a page at 578k roles. Sort on a stored column and count the
  page's ids. A nested `include: { take }` is not a per-parent LIMIT either: Prisma loads every
  child row of the page's parents and trims in memory (27,521 holdings for 25 firms) — sample
  with a raw `LATERAL … LIMIT`.
- `/people` — people directory (URL-driven filters, same pattern as companies): search,
  an "at several companies" toggle (`companyCount > 1`), sort by roles held (the stored
  `Person.roleCount`) or name; card counts are live for the page's ids. The unfiltered total is
  cached 15 minutes per viewer mode (`PEOPLE_TOTAL_TTL_MS`: counting every person is a seq scan);
  search and multi-company totals are exact. **No role filter** —
  3,744 distinct free-text role strings is not a vocabulary. `/people/[slug]` — person
  profile: roles grouped by organisation, each with its kind, year range and citation.
- `/companies/[slug]/history` — paginated change timeline for one company (what changed, from
  what to what, who, when), **CONTRIBUTOR/ADMIN only** (`canViewCompanyHistory` in `@repo/api`):
  the web's `requireCompanyHistory` sends a signed-out visitor to login and 404s any other role,
  and the API answers 401/403. Those roles are always unlocked, so entries are not gated (a
  revision's `before`/`after` can carry any value a row ever held, partner values included) and
  `hiddenCount` is always 0. `noindex, follow`, so it never competes with the profile in search.
- `/admin/users` — account list: search, ban/unban (a ban revokes sessions and rejects
  the user's pending queue), and one "Make user / contributor / admin" button per other role
  (a downgrade revokes the API keys the new role no longer permits; a ban revokes all).
  A mono `2FA` badge (`No 2FA`, dashed, for an un-enrolled admin/contributor) and, when enrolled,
  a monochrome **Reset 2FA** button (`resetMfaAction` → `POST /admin/users/:id/reset-mfa`).
  A Contributions cell (`approvedCount` / `pendingCount`, one `UNION ALL` grouped by user and
  status) links into the queue's per-user view.
- `/profile/settings` → **Security** (`SecuritySection.tsx`): Passkeys (list, "Synced"/"This
  device", add via `startRegistration`, remove), Authenticator app (set up / remove), Recovery
  codes ("N of 10 remaining", regenerate). Every change is an inline password step (no modal)
  → a server action in `settings/actions.ts` → `lib/account.ts` → API; 401 maps to the password
  field. Removing a required role's last factor is disabled in the UI and refused by the API.
- `/login` — password form plus "Sign in with a passkey" and passkey **autofill** on the email
  field (`autoComplete="username webauthn"`, conditional mediation started on mount and aborted
  on unmount). The login route answers `{ status: 'ok' | 'mfa' | 'mfa_setup' }`; `mfa` swaps the
  form for `SecondFactorStep`, `mfa_setup` goes to **`/login/setup-2fa?next=`** (forced setup:
  "Add a passkey" or an authenticator app, then the recovery codes, then `next`; redirects to
  `/login` without the `capbase_mfa` cookie; `noindex`, under the robots-disallowed `/login`).
  `/admin/login` runs the same step with `admin`.
- `/profile` — besides contributions and the watchlist (`SavedCompanies.tsx`, every signed-in
  user; masked values through `Masked`), a full-access viewer gets **Saved searches**
  (`SavedSearches.tsx`: rerun link, inline rename, delete), a monitor toggle on each saved search
  and saved company (`MonitoringToggle.tsx`: Preparing / On / Paused), and a link to
  **`/profile/updates`** (the monitoring feed, `noindex`, `no-store`, cursor pages; 403 says
  "needs full access", any other failure "could not be loaded"). `/profile/settings` adds the
  **Weekly email** toggle (`DigestPreference.tsx`; turning it on needs full access and a verified
  address, turning it off is always offered). The web decides whether to show any of this by
  calling the feature itself (`canSaveSearches()` → `GET /auth/me/saved-searches?limit=1`; 200 =
  show), never a separate access endpoint; signed out makes no request. `/companies` shows **Save
  search** (`SaveSearch.tsx`) on the same check, saving the current controls' canonical params.
  `lib/saved-searches.ts` / `lib/monitoring.ts` are the seams (`no-store`, no mock fallback).
- `/unsubscribe` — a route handler, not a page (no layout, analytics or scripts; `noindex`,
  `no-referrer`, `no-store`, robots-disallowed). GET is inert: a minimal HTML confirm form. POST
  takes the token from the query (RFC 8058 one-click from a mail client) or the form body and
  forwards it to API `POST /monitoring/unsubscribe`. It never claims a success it did not get: an
  API failure is a 503 "try again", a malformed link a 400.
- `/profile/api-keys` — self-serve API keys for the public API (`/v1`, see Backend). A `USER`
  sees an `EmptyState` saying admins grant access; an unverified contributor sees
  `VerifyEmailBanner` and no form; a verified `CONTRIBUTOR`/`ADMIN` sees their active keys
  (one revoke `<form>` per row) and `ApiKeyForm` (RHF + zod, `lib/validation/api-key.ts`; a
  scope `SelectField` for admins only). The secret is shown **once**, in the reveal panel the
  create action returns it to — never stored or re-fetchable. `lib/api-keys.ts` is the seam.
- `/developers` — the public API guide (auth, scopes, limits, IP allowlist, writing data,
  errors), every number read from the `@repo/api` constants (`API_KEY_LIMITS`, …). Links to
  Swagger UI at `/v1/docs`, which the **API** serves — so it is a plain `<a>`, not a `Link`.
  In the sitemap and the footer ("API"); `/v1/` itself is robots-disallowed.
- `/admin` — moderation queue (ADMIN only). `/admin/login` signs in via
  `app/api/admin/login` which stores the JWT in an httpOnly `capbase_token` cookie.
  `lib/auth.ts` (`requireAdmin`) gates pages; `lib/admin.ts` + `app/admin/actions.ts`
  (server actions) approve/reject. The admin layout renders **no header of its own**: under
  the public `SiteHeader` it adds `AdminNav` (`app/admin/AdminNav.tsx`, Queue/Reports/Merges/
  Claims/Users/Visibility), whose pending counts come from `GET /admin/submissions/count`, `GET
  /admin/merges/count` and `GET /admin/claims/count` — bare counts, never the queues themselves, since the layout runs on
  every admin page. The nav is **rendered only for an ADMIN session**, and only then are the
  counts fetched. Signed-out visitors and ordinary users on `/admin/login` see nothing
  admin-shaped. Never link to `/admin` from the public site. **Both queues are
  paged and no admin read may load a whole status**: APPROVED is every ingested row (~255k), and
  loading it ran the API out of heap. Submissions page by cursor (`before` ← `nextCursor`,
  `SUBMISSION_PAGE_SIZE`; nine tables merged on `(<sort key> desc, type, id desc)`, so an
  offset would load every row above it from each), merges by page number (`MERGE_PAGE_SIZE`,
  windowed across signals in `MERGE_SIGNALS` order). Every admin page is Tailwind +
  `components/ui` inside `PageContainer` (so it shares the header's left edge), with filter pills
  from `app/admin/FilterLink.tsx`. Copy **`merges/page.tsx`** (header, `FilterLink` pills,
  `Card` rows, one `<form action={fn.bind(null, …)}>` per button) for any new admin page. The
  queue renders each submission as an **open** `Card` (every field visible, no expand; an
  `investorProposal` shows the same field diff as a company proposal and links the firm), ending
  in one form whose Approve/Reject buttons pick the action via `formAction`. The reason is sent
  only on reject. **Queue filters** (`SubmissionQuery`, all URL params, one `queueHref` helper
  that drops `before` on every change): status pills; on a decided status a **Contributed /
  Ingested** source pill (the web defaults to `contributed`; the API defaults to `all`, which
  `/v1/submissions` keeps); type pills; a GET search box `q` matching the company (or, for an
  investor edit, the firm) name through the trigram indexes; and `user=<id>`, the **per-user
  view** — every submitter on a card links there, headed by a card from `GET /admin/users/:id`
  (`AdminUserDetail`: counts per status, `accessFor`'s gate state, so a retraction's effect on
  access shows at once, and the account's company claims with a Revoke form each); and
  `representative=1`, the **Verified representatives** pill (see Backend → Company claims): every
  card submitted under a claim that is active *now* carries a "Verified representative" badge
  (ink border, no colour), with the filter on or off. **Sort key** (`submissionSortKey`): decided contributed rows sort by
  `reviewedAt` (newest decision first, served by `(moderationStatus, reviewedAt, id)`),
  everything else by `createdAt`. Each decided card says "Approved/Rejected by <admin> · date".
  **Retraction**: rejecting an APPROVED row (`notice.status` read before deciding) unpublishes it
  and writes a whole-row `RETRACT` revision; rejecting an approved company or investor edit
  (`revertProposal` / `revertInvestorProposal`) restores each field that still holds the
  proposal's value (from its newest real `UPDATE` revision, or the investor proposal's
  `previous`), re-adds the partner marks the approval removed (`clearedPartnerFields`; null =
  approved before it was recorded → fail closed: a `PARTNER`-identified or `partnerOnly` row
  re-marks every restored non-null value), writes one `RETRACT` revision per restored field,
  deletes the field citations the approval minted (unless another approved proposal cites the
  same URL for that field), and returns/logs `revertedFields` / `skippedFields`. No cascade: a
  retracted company keeps its approved children. Access needs nothing extra — `accessFor` reads
  approved rows live. The web layer does no
  per-action auth; the API's `@Roles('ADMIN')` on `AdminController` is the gate.
  `POST /admin/people/:id/suppress|unsuppress` exists in the API; its only web UI is
  Suppress & resolve on a person report (below).
- `/admin/reports` — the "Report an issue" queue, OPEN/RESOLVED/DISMISSED pills, an
  `OPEN (n)` count in the admin nav (the only signal — no email). Each OPEN card is **one**
  `<form>` (note + link inputs) whose buttons pick the server action via `formAction`:
  Resolve, Dismiss, and on an unsuppressed person Suppress & resolve. Resolving is
  bookkeeping only — companies/investors are never hidden by a report.
- `/admin/visibility` — the read gate's settings (see Backend → the read gate), `FilterLink` tabs
  Company / Investor / Fund / Person / Settings (`?tab=`). **Sections**: one `Card` per section
  (`SectionPolicyRow.tsx`), Selects for Signed out / Signed in / Contributed (a block offers only
  Hidden/Full), a Preview rows field (enabled only when a tier previews), the partner rows
  audience, a "Search engines see: …" line (`crawlerView`: the signed-out level, plus "public rows
  only" below a partner audience of everyone) and "Default" or "Changed by <admin> · date".
  **Facts** (`FieldPolicyRow.tsx`): audience and partner audience (options below the audience
  disabled), noting the directory filter/sort it also locks. **Settings** (`WindowRow.tsx`): the
  contribution window. Every row is its own RHF + zod form (`lib/validation/visibility.ts` mirrors
  the DTOs and runs the same `@repo/api` validators) with Save and, when overridden, Reset to
  default; server actions in `app/admin/visibility/actions.ts` → `lib/admin.ts` → `GET /admin/
  visibility`, `PUT|DELETE /admin/visibility/sections/:section`, `…/fields/:entity/:field`,
  `…/settings/contribution-window` (`AdminVisibilityController`, `@Roles('ADMIN')`; unknown key →
  404, a refused rule → 400 whose message is the form error). Each write reloads the policy
  before it answers and logs `Gate policy: <admin> set …`.
- `/verify-email?token=` — spends a verification link on a **button press, never on load**
  (mail scanners open every link and would burn the token). Signed-in, unverified, non-admin
  users see `components/VerifyEmailBanner.tsx` (with a "Resend link" button) on `/profile`,
  `/profile/settings`, `/profile/api-keys`, `/contribute` and `/companies/[slug]/contribute`. Robots-disallowed,
  `noindex`, `no-referrer`.
- `/companies/[slug]/claim` — "This is my company" (outside `(profile)`, like `contribute/`;
  `requireUser`, `noindex`, robots-disallowed). Lists the caller's claims on the company (each with
  Withdraw), then `ClaimEmailForm` when `CompanyClaimView.emailClaim` (a work address; the
  company's stored domain is **never** rendered — it may be partner data) with a "My address isn't
  at this company's domain" disclosure holding `ClaimRequestForm`, or only `ClaimRequestForm`
  (note + evidence URL) when the company can't be claimed by email. Both are RHF + zod
  (`lib/validation/claim.ts`, the must-tick `authorised` box via `AttestationField`'s `label`) with
  Turnstile. Entry points: "This is my company" in `ProposeChangeMenu` ("You represent this
  company" when `viewerClaim` is set), the profile footer sentence, and `StubProfile`'s
  `claimHref` on a partner-only stub. `lib/claims.ts` is the seam (`no-store`, no mock fallback,
  `claimErrorMessage`); `lib/claim-status.ts` the client-safe status labels.
- `/verify-claim?token=` — a copy of `/verify-email`: spends the claim link on a **button press,
  never on load**. Robots-disallowed, `noindex`, `no-referrer`.
- `/admin/claims` — company claims, `FilterLink` pills Pending / Active / Ended (paged by number,
  `CLAIM_PAGE_SIZE`, `GET /admin/claims?status=&page=`), one `Card` per claim (company, user →
  per-user view, method, address or note + evidence link, who decided). Pending cards: one form,
  Approve / Reject via `formAction` and a reason box (sent only on reject, quoted in the email,
  not stored); active and suspended cards: Revoke. `/admin/users` rows show "Claims (n)"
  (`AdminUser.claimCount`).
- **Profile mark**: `components/CompanyRepresentation.tsx` under the one-liner — "Profile
  maintained by the company" and, once a representative confirmed, "· Confirmed current by the
  company on <date>" (worded so it can't read as a source retrieval date). The representative sees
  `ConfirmCurrentButton` in the action row (and an item in `MoreActionsMenu` on a phone), disabled
  "Confirmed today" when `!viewerClaim.canConfirm`. Never in metadata, JSON-LD or the OG image.
  `/profile` lists "Companies you represent" (`CompanyClaims.tsx`, rendered only when non-empty;
  "Awaiting review" for an open request). The history page's `actorLabel` reads "Company
  representative · approved by <admin>" for a `Revision.representative` entry — never the
  representative's name.
- `/report/[type]/[slug]` — the public report form for a company/investor/person profile
  (linked from each profile's footer). Anonymous even when signed in: `lib/reports.ts` sends
  **no** authorization header, only the Turnstile token. Robots-disallowed, `noindex`.
- `/terms`, `/privacy`, `/data`, `/takedown` — the `(legal)` route group: one prose layout
  (`(legal)/layout.tsx`) styles bare `h1/h2/p/ul/a` via descendant selectors, so a page is
  plain semantic HTML plus `metadata` and a `LAST_UPDATED` line. Site-wide constants
  (`SUPPORT_EMAIL`, `SOURCE_URL`, `DATA_LICENSE_URL`) are **hardcoded** in `lib/site.ts`,
  not env. A new indexable static page must be added to `STATIC_PATHS` in `lib/sitemap.ts`
  (the sitemap is route-handler based; there is no `app/sitemap.ts`; each child file fetches
  only its own page, `GET /<family>/sitemap?page=N` in `SITEMAP_PAGE_SIZE` rows, and the index only
  `GET /<family>/sitemap/count` — never a whole family: a 24 MB read ran the 512 MB API out of heap); a new form route must be
  added to `disallow` in `app/robots.ts`. Footer links live in `COLUMNS` in
  `components/SiteFooter.tsx`.

**SEO metadata:** an indexable page spreads `...canonical(path)` (`lib/metadata.ts`), which
sets `alternates.canonical` **and** `openGraph.url` together — Next merges metadata shallowly
per key, and the root layout deliberately sets neither, so a page without it (auth, admin,
404) emits no canonical rather than claiming to be `/`. Directory pages pass
`directoryCanonical(base, searchParams)` (`lib/list-params.ts`): a bare `?page=N` is
self-canonical, any filter collapses to the bare URL. Company/firm stubs with non-empty
public prose are indexable and in the sitemap (`indexable` on `CompanyDetailResponse` /
`InvestorDetailResponse`); bare stubs stay `noindex`. Signed-out directories and search
still omit partner-only entities. Thin person/investor profiles render
`noindex, follow` and leave the sitemap; the API owns that rule (`indexable` on the detail
response, `PERSON_INDEX_MIN_ROLES` in `@repo/api`, the same filter in each `listSlugs`) — the
web never re-derives it. `Company.founded` is `0` when unknown: render it through
`foundedYear()` (`lib/format.ts`), never raw.

**Entity ids on the web side:** the `Company` and `Investor` domain types expose **no `id`,
only `slug`** (a company's row id is recoverable only through its citations,
`companyEntityId()`); `Person` and every child row (round, role, holding, deal, …) do expose
`id`. Key new company/investor features by slug and resolve on the API.

**Contribution forms:** the six child forms and `EditCompanyForm` share `ContributionShell`
(`app/companies/[slug]/contribute/forms.tsx`) — Turnstile state, `FormError`, submit button,
success panel; children render above the widget. `CompanyForm` duplicates that plumbing
inline. Server actions → `lib/contribute.ts` `submit*` → API. `apps/web` has no test suite.
`/takedown` carries a **TODO(manual)** placeholder for the DMCA designated agent.

Run the web app with `yarn dev` (it serves on port 3001). It expects the API at
`API_URL` (default `http://localhost:3000`).

## Backend (apps/api)

NestJS 11 REST API on port 3000. Auth = JWT + roles (USER/CONTRIBUTOR/ADMIN), bcrypt; plus
personal API keys for the public `/v1` surface (below). `CONTRIBUTOR` is granted by an admin
only; it moderates nothing, it may mint contributor keys and is always unlocked. Every
crowdsourced row carries `moderationStatus` (PENDING/APPROVED/REJECTED); public reads
return only APPROVED, `/admin/*` (RBAC) lists pending and flips status. Services map
Prisma rows → shared `@repo/api` types (`src/companies/company.mapper.ts`). DTOs use
`class-validator` and `implements` the shared `Create*Input` types. The global
`ValidationPipe` is `{ whitelist: true, transform: true }` **without**
`forbidNonWhitelisted`: an undecorated DTO property is silently stripped, not rejected — a
new required field must carry a validator or it vanishes. Config comes from
env (`apps/api/.env`, see `.env.example`).

Mail goes through `MailModule` (`src/mail/`, Resend) — a no-op that only logs (with the
link, outside production) when `RESEND_API_KEY` is unset. **Every email is a template
checked into the repo**: `src/mail/templates/<name>.{html,txt}` (standalone, table-based,
inline-styled HTML plus a plain-text twin), registered with its subject and
`{{{UPPER_SNAKE}}}` placeholders in `src/mail/templates.ts`. The API fills them (values
HTML-escaped in the html body; a missing value throws) and sends both bodies — there are no
Resend hosted templates. Emails **hardcode the ledger hex values**, the one exception to the
no-hex rule, because email clients have no CSS variables. `nest-cli.json` `assets` copies
the files into `dist/`; `templates.spec.ts` fails if a file and the registry drift;
`make mail-preview` renders them to `apps/api/.mail-preview/`. Conventions:
`src/mail/templates/README.md`. Every send is best-effort (`deliver` never throws) **except**
`sendDigest`, the monitoring digest's result-bearing transport (`sent | retry | failed |
disabled`, Resend idempotency key, a 15 s `Promise.race` bound — Resend's send options take no
abort signal). Repeated rows go through `renderDigestRows`, the only constructor of the branded
`SafeHtml` that `fill` inserts unescaped; every other value is escaped.

**Moderation emails.** `AdminService.moderate` emails the contributor once per decision
(`submission-approved` / `submission-rejected`, built in `src/admin/submission-notice.ts`).
Every contribution is a single row (a round carries its investors, a proposal all its
fields), so one decision is one email. It reads the row *before* deciding (for the summary
and the prior status) and sends only *after* the transaction commits, **un-awaited** —
mail can never slow, fail or roll back a decision; `MailService` logs and reports failures
to GlitchTip (no recipient in the report). No email for ingested rows, admins, banned users,
unverified addresses, or a decision that repeats the current status. The optional rejection
`note` (`ModerationDecisionInput`, ≤ `MODERATION_NOTE_MAX`) is quoted in the email and **not
stored**; each queue card's decision form has an optional reason box, sent only with Reject.

**Queue emails to admins.** `QueueAlertsService` (`src/admin/queue-alerts.service.ts`, plain
`cron` `CronJob`s, no `@nestjs/schedule` in the api) emails every unbanned ADMIN a
`queue-digest` (counts by type + oldest age, only when non-empty; `QUEUE_DIGEST_CRON` in
`QUEUE_DIGEST_TZ`) and a `queue-alert` when PENDING reaches `QUEUE_ALERT_THRESHOLD` (default
100, `0` = off), checked every 10 min, fired once and re-armed only below the threshold
(in-memory, so a restart may re-send). Counts come from one `aggregate` per table
(`pendingQueueStats`), never `listSubmissions`. `validateEnv` rejects a bad cron/zone, which
would otherwise crash bootstrap.

**Email verification.** Registering sends a `verify-email` link (24h, single-use, only the
sha256 stored — the same pattern as password reset); spending it at `POST /auth/verify-email`
sets `User.emailVerifiedAt` and sends the `welcome` email, once. `POST
/auth/resend-verification` (JWT) is limited to one link per account per minute → 429; that
cooldown, not nginx, is the throttle (the web's resend button is a server action, so it
lands in nginx's `writes` zone). Changing the email clears verification and mails the new
address; each `EmailVerificationToken` is bound to the address it was sent to, so an old
link can't verify a new one. `AuthUser.emailVerified` / `RequestUser.emailVerified` carry
the flag (`JwtStrategy` reads it from the row, like role).

**Two-factor & passkeys (`src/auth/mfa/`).** Login is a small state machine on the API carried
by `AuthChallenge` rows (opaque 32-byte token, only its sha256 stored, single-use via a
conditional `consumedAt` update, `MFA_MAX_ATTEMPTS` 5; 5 min, forced setup 15). `POST
/auth/login` returns the **`LoginResponse` union**: `ok` (the session, as before — still 201),
`mfa` (a `LOGIN_MFA` challenge + `methods`, **no token**) or `mfa_setup` (a required role with no
factor: an `MFA_SETUP` challenge, no session until a factor is enrolled via
`/auth/login/setup/{totp,passkey}…`). `POST /auth/login/mfa` finishes with `totp` | `recovery` |
`passkey`. `MfaService` owns challenges, TOTP (hand-rolled RFC 6238 in `totp.ts`, ±1 step,
`User.totpLastStep` rejects a replay with a conditional update; the secret is AES-256-GCM sealed
under `MFA_ENCRYPTION_KEY` by `secret-box.ts`, HKDF from `JWT_SECRET` outside production),
recovery codes (`RECOVERY_CODE_COUNT` 10, sha256 of the normalised code, spent by conditional
`updateMany`), the account lockout (`MFA_ACCOUNT_FAILURE_LIMIT` 10 failures across `LOGIN_MFA`
challenges in `MFA_LOCKOUT_MINUTES` 15 → 429 + one `security-notice` email) and the shared
bookkeeping (`factorAdded` sets `mfaEnabledAt` and issues codes if none; `factorRemoved` clears
both when the last factor goes). `PasskeyService` wraps `@simplewebauthn/server` (v13, CJS):
rp id = `WEBAUTHN_RP_ID` or `SITE_URL`'s host, origin = `SITE_URL`'s; discoverable credentials;
passwordless sign-in (`/auth/passkey/options|login`) requires user verification and bypasses
`LOGIN_MFA`/`MFA_SETUP`; every passwordless failure is the same generic 401; a counter that fails
to advance is rejected. Signed-in management is `/auth/me/mfa…` and `/auth/me/passkeys…`, each
change password-confirmed (`AuthService.confirmPassword`) and emailed (`security-notice`).
**`MfaPolicy`** (`policy.ts`, its own `MfaPolicyModule` because `AuthModule` imports
`ApiKeysModule`) reads `MFA_REQUIRED_ROLES` once: **unset → `ADMIN,CONTRIBUTOR` in production,
none elsewhere; set (even empty) → exactly that** — so local dev and every e2e suite sign in with
a password as before. Enforcement is two checks off the row already read: `JwtStrategy` rejects
`policy.unmet(user)` (an existing session dies, a promotion is caught at once) and
`ApiKeysService.authenticate` answers `403 { code: 'MFA_REQUIRED' }` (keys suspended, not
revoked). A required role can't remove its last factor (400). **A password reset never disables
2FA**; the recovery path is a recovery code or the admin `POST /admin/users/:id/reset-mfa`
(`AdminUsersService.resetMfa`: not yourself; deletes passkeys, codes and challenges, nulls TOTP
and `mfaEnabledAt`, bumps `tokenVersion`, emails). `test/mfa.e2e-spec.ts` overrides `MfaPolicy`
to run the enforced flow.

Abuse controls: every contribution route uses the `@Contribution()` decorator
(`JwtAuthGuard` + `VerifiedEmailGuard` + `PendingCapGuard` + `TurnstileGuard`, cheapest
first). An unverified non-admin gets `403 { code: 'EMAIL_UNVERIFIED' }` (`@repo/api`), which
the web's `contributionErrorMessage` turns into a pointer at the banner. The cap is
`MAX_PENDING_SUBMISSIONS` (15, `@repo/api`) PENDING rows per user → 429; admins are
exempt from both. `TurnstileGuard` (also on `POST /auth/register`) is a no-op without
`TURNSTILE_SECRET` and fails closed when Cloudflare is unreachable. `POST /reports` is the one
other anonymous write: `@UseGuards(TurnstileGuard)` only, no pending cap, nginx `writes` in
front (`src/reports/`; the admin side is a separate `AdminReportsController` on
`admin/reports`). The JWT is only
identity: `JwtStrategy` re-reads the user, so role, ban and `tokenVersion` come from the DB.

**The read gate.** Anyone can read; how much a viewer receives is a **policy an admin can
change** (`/admin/visibility`), applied **in the API** so a hidden value never reaches the
browser. The policy lives in `@repo/api` `domain/visibility.ts`: the code **defaults** (which
reproduce the original fixed gate) plus the stored **overrides** — the database holds only
overrides, so no row means the default and "Reset to default" deletes the row. Three viewer
tiers: `signedOut`, `signedIn` (no live contribution) and `unlocked` (an approved contribution
inside the window, or the CONTRIBUTOR role). **Admins bypass everything** (`access.admin`).

1. **By section.** `SECTION_REGISTRY` lists every profile section (its page, label, `kind:
   rows | block` and default); `GateSectionPolicy` overrides one. A section gives each tier
   `hidden | preview | full` (`previewRows` 1..25, default 2), never less for a tier with more
   access; a `block` (`fundTerms`, `fundMandate`, `investorFocus`) is never previewed.
   `gateLimit(section, access, policy)` is the row count (0 / `previewRows` / Infinity). Defaults:
   company rounds, diversity, acquisitions, exits, investor LP commitments, fund commitments and
   metrics `members` (hidden / preview / full); investor focus and the fund mandate `members`
   blocks (hidden / full / full); fund terms `contributors` (hidden / hidden / full); the rest
   `open` (preview / preview / full). A section **hidden from every tier is switched off**: no
   rows and no derived summary (`latestRound`; no `termsHidden`/`mandateHidden` lock) for anyone
   but an admin. An approved contribution unlocks for `contributionWindowDays` (`SiteSetting`,
   default 30, 1..365; a change applies to every user at once).
2. **By provenance**, three ways:
   - **Rows** — each section's `partnerAudience` (default `signedIn`) says who receives the
     partner's rows (`externalSource = 'PARTNER'`, partner `RoundInvestor`s, partner-corrected
     round/term columns via `gateRowFields`).
   - **Fields** — `FIELD_REGISTRY` lists every configurable header fact of company / investor /
     fund (with the directory filter and sort it backs); `GateFieldPolicy` overrides one with an
     `audience` (who sees the value at all) and a `partnerAudience` (who sees it when the partner
     wrote it, ≥ audience). Defaults: everyone / `signedIn`, except company and firm `oneLiner`
     and `description` (public prose: everyone / everyone). A withheld field is blanked and
     listed in the entity's `masked`, with `maskedUnlock[field]` saying what reveals it
     (`signIn` | `contribute`) — everywhere it renders (profile, directory rows, featured,
     search hits, the investor page's fund cards). A field outside the registry keeps the fixed
     partner rule (masked signed out).
   - **Entities** (fixed, `partnerVisible`) — a **partner-only entity** (`partnerOnly`; for
     people `identifierOnly`) is a stub signed out (name, the prose its field policy allows,
     counts, `partnerOnly: true`) and absent from signed-out directories and `/search`.
     Company/firm stubs with prose are indexable and in the sitemap; bare stubs, funds and
     people stay `noindex`. `indexable`, canonical and the sitemap never depend on the policy.

3. **Section-backed directory filters.** A `SECTION_REGISTRY` entry may carry `filter: { param, label
   }` — `companyRounds` → `round` (every financing criterion), `companyInvestors` → `investor`. The
   filter needs **full** access to its section (`sectionFilterGate`; a preview tier would let
   membership reveal rows past the cut), so under the defaults both are contributors-only; the
   lowest tier that gets `full` is its `unlockBy`. A section hidden from every tier (or one no tier
   gets in full) puts its param in `DirectoryPage.locked.disabled` — the API ignores it and the web
   renders nothing, not a lock. `directoryFilters` also hands the query builder `rows(section)`
   (`publicRowsWhere`) and `partnerColumns(section)` (round columns a criterion may not match on below
   the partner audience), so the builder never reads the policy. `listAccessFor(…, force)` runs the
   contribution lookup for a signed-in USER only when such a filter is applied and
   `sectionFiltersNeedLookup` says the tier matters — a plain directory stays one query. Range keys
   (`raised`, `valuation`, `founded`, `headcount`) are ordinary `FIELD_REGISTRY` filter keys covering
   their `…Min`/`…Max` params. The admin section row carries `filter` and says "Also locks the …
   filter on /companies (needs Full)".

**Counts and market aggregates stay public and unconfigurable**, partner rows included — a
count says rows exist, not what they say, and it is the sign-in hook. Directory filters and sorts
follow the field policy (`directoryFilters`): a filter on a field the viewer may not see is
ignored and reported in the response's `locked.filters` (so is a partner-only column below its
partner audience — fund `status` — where narrowing would match nothing); a filter on a field
whose partner value is withheld never matches a partner-marked value; a sort on a hidden field
falls back to the default (name; for funds, whose default is size, name too) and is reported in
`locked.sorts`. A sort on a partner-gated value is an **accepted trade** (it can reveal the rank,
never the value).

The policy is read **synchronously** from `GatePolicyService.current()` (`apps/api/src/gate/`,
`GateModule`, global): an in-memory snapshot loaded at boot, reloaded on every admin write and
refreshed in the background after `GATE_POLICY_TTL_MS` (60 s, single-flight; a failed load keeps
the last snapshot and logs; an invalid stored row is dropped and logged). So a profile (`no-store`)
reflects a change on its next load; a signed-out directory within its 60 s ISR.

Who is unlocked lives in **one** place, `UsersService.accessFor(viewer?)` → `ViewerAccess
{ unlocked, signedIn, unlockedUntil, admin, windowDays }`: anonymous is locked and `signedIn:
false`, an ADMIN or CONTRIBUTOR is unlocked with no query, everyone else is unlocked while their
latest APPROVED row (any reviewable type, proposals included) is inside the policy's window.
`unlockedUntil` is still reported after it lapses so the UI can say when. Every profile read calls
`accessFor` — company, investor, fund, person, history, `GET /auth/me/contributions`, `GET
/companies/featured` — never a re-derivation. Directory lists and `/search` use
`listAccessFor(viewer, policy, entity, accessFor)`: signed out, CONTRIBUTOR and ADMIN read off the
role with no query (`listAccess`); a signed-in USER pays `accessFor` (nine indexed `findFirst`s)
**only while** some field of that entity (or the card's partner rows: investor portfolio, person
roles) has a `contributors` audience — otherwise a list stays one query.

Enforcement goes through **one module, `apps/api/src/gate/`**: `publicRowsWhere(access, policy,
section)` (the child-row filter, in its `OR` form because Prisma's `{ not: 'PARTNER' }` drops
NULL-source rows), `rowVisible`, `visibleRoundInvestors`, `gateFields(kind, entity, partnerFields,
access, policy, blanks)` and `gateRowFields` (with per-entity blanks for non-nullable fields),
`maskFields`, `stubFor`, `takeFor`/`limitRows`, `listAccess`/`listAccessFor` and
`directoryFilters`; the pure resolvers (`sectionLimit`, `sectionView`, `fieldGate`,
`fieldUnlockBy`, the validators) are in `visibility.ts`. (Company history needs none of it: it is
CONTRIBUTOR/ADMIN only, see Routes, and shows every revision whatever the policy hides.) Mappers
stay pure: a service maps, then gates. Each section is capped **in the query** (`take`), so a
gated row is never even loaded, and counts come from separate indexed `count()`s over every
approved row. A new read has these to call. **A new section or fact must be added to the
registry** (`SECTION_REGISTRY` / `FIELD_REGISTRY`) — a section is also a `GatedSection` type, so
`gateLimit` won't compile without it; a field outside the registry silently keeps the fixed
partner rule and is not configurable.

Gated reads carry access **in-band**: the route sits behind `OptionalJwtAuthGuard` and the
response includes `access` (`CompanyDetailResponse`, `InvestorDetailResponse`,
`FundDetailResponse`, `PersonDetailResponse`, `CompanyHistoryResponse`,
`FeaturedCompaniesResponse`), so a page needs one request and there is no standalone "am I
unlocked?" endpoint. The four detail responses also carry **`gate: { sections }`** — a
`SectionView { disabled, unlockBy, adminOnly }` per section of that page, computed for this
viewer by `sectionView` — and the four directory lists return **`DirectoryPage<T>`**
(`Paginated<T>` plus `locked: { filters, sorts, unlockBy, disabled }`; `/companies` returns `CompanyDirectoryPage`, which adds `screen`). `/v1` lists return the same
superset. **Don't add a guard for this**: the guards (`JwtAuthGuard`,
`OptionalJwtAuthGuard`, `RolesGuard`, `VerifiedEmailGuard`, `PendingCapGuard`, `TurnstileGuard`)
decide whether a request may proceed, whereas the gate decides how much a request *sees*. Load
citations only for rows already in the response, so a locked viewer never receives a citation
for a row they can't see. `/v1` passes the key owner — a CONTRIBUTOR/ADMIN, so always unlocked.

**Company screening** (`GET /companies`, and so `/v1/companies`). The contract is one shared module,
`@repo/api` `domain/screening.ts`: `CompanyScreenQuery` (which `CompanyListQuery` extends), the
bounds, `validateCompanyScreen` (cross-field rules; the message names params only — run at the top
of `findAllApproved`, so both controllers share it → 400), `resolveRoundWindow` (rolling windows
resolved per request, month-end clamped; fixed `roundTo` inclusive), the lenient `parseCompanyScreen`
and the canonical serialiser `companyQueryToParams` + `COMPANY_QUERY_VERSION` (saved searches persist
exactly this). The `where` is built by the pure `apps/api/src/companies/company-screen.ts`:
scale ranges match a **recorded** value only (`gt: 0` always — 0/`null` is the unknown sentinel);
every financing criterion lands in **one** `rounds: { some }` (EXISTS: same-round semantics, no
fan-out, `count` and pages agree), appended to the company `AND` (never a second top-level `OR`; `q`
owns it). The investor resolves slug → live firm through merges (`prisma/merge-chain.ts`
`resolveInvestorSurvivor`, shared with `InvestorsService`); signed out a partner-only firm answers
like an unknown slug (`screen.investorNotFound`, empty page). Scope: `round` (named on the matching
financing, inside the round predicate), `holdingsAndRounds` (default, when rounds are usable) or
`holdings`. For `holdingsAndRounds` the service pre-resolves the linked company ids with two Prisma
reads (`investorLinkReads`) and filters `id IN (…)`: an `OR` of two EXISTS scans every company (651
ms for Y Combinator → 13 ms); past `INVESTOR_LINK_CAP` per branch it falls back to the EXISTS form.
The response is `CompanyDirectoryPage` (`DirectoryPage<Company>` + `screen`: the resolved investor
and scope, the window applied, and per row the latest matching round — read with the same predicate,
≤ pageSize `LIMIT 1` reads, gated by `gateRowFields`, with its citation). `screen` is null when no
screening param applied. No new sorts; `/v1` limits and `MAX_V1_LIST_DEPTH` unchanged.
`test/company-screening.e2e-spec.ts` is the fixture suite (split rounds, duplicates, unknown figures,
boundaries, grant vs equity, merges, namesakes, partner rows/fields, every tier, `/v1` parity).

**Saved searches and monitoring** (`src/saved-searches/`, `src/monitoring/`; plan
`thoughts/shared/plans/2026-11-11-saved-searches-and-monitoring.md`). Every route needs **current full
access** (`ViewerAccess.unlocked`): `JwtAuthGuard` + `FullAccessGuard`, which answers `403 { code:
FULL_ACCESS_REQUIRED }` and attaches what it resolved (`CurrentAccess`) so the service reuses it
rather than re-running `accessFor`. Another user's id is a 404. The two exceptions only turn email
**off**: `DELETE /auth/me/digest` (JWT only) and `POST /monitoring/unsubscribe` (no auth; HMAC token
`digestUnsubscribeToken`, HKDF of `JWT_SECRET`, nothing stored, every link ever sent stays valid;
`UnsubscribeThrottle` 1,000/min because mail providers POST from shared IPs).
- **Saved search** = `name` + `version` (`COMPANY_QUERY_VERSION`) + `params`, the canonical
  `companyQueryToParams` string (every screening param included). Saving is **strict**
  (`decodeSavedParams`: unknown or repeated keys, `page`/`pageSize`/`slugs`/`domain` → 400; then
  `ListCompaniesDto` + `validateCompanyScreen`); directory URLs stay lenient. Criteria are not
  editable (rename/delete only). An unknown version is never run or monitored, and never run
  unfiltered. Routes: `GET|POST /auth/me/saved-searches`, `PATCH|DELETE /:id`.
- **Monitoring** is opt-in per source (`PUT|DELETE /auth/me/saved-searches/:id/monitoring`,
  `…/saved-companies/:slug/monitoring`; saving never enrols) and records a silent **baseline**.
  `MonitoringService.runOnce(now)` runs hourly in the API (`MONITORING_ENABLED`, `MONITORING_CRON`;
  an in-process flag stops overlap; every write is `ON CONFLICT DO NOTHING`, so a re-run never
  duplicates). A search's members come from `CompaniesService.monitorSelection` — the directory's
  own `directoryWhere` for a synthetic **unlocked non-admin** viewer (the audience ceiling is
  `contributors`, so that is what every full-access owner sees), built once per evaluation and
  paged by id (`companyIdsPage`). If the policy now ignores a param the search sets, the search is
  `unavailable`, never run broader. Seen sets ignore visibility (`MonitorSeenCompany` per search,
  `MonitorSeenRound` per user), so a policy change never creates events. Funding is one SQL
  statement per 200 owners (data-modifying CTEs share a snapshot: a round is evented and marked
  seen together or not at all) and covers APPROVED Equity/Debt only; grants are marked seen and
  never reported. An owner without full access is skipped and their sources reset to
  `baselining`, so regaining access never replays the gap. Turning a search on baselines ≤ 10k
  matches inline; a broader one finishes on the next run. A merge marks both companies' rounds
  seen for their monitors and copies each search's seen loser onto the survivor
  (`merge-monitoring.ts`); saves carry `monitoredAt` through merge/unmerge.
- **Events** (`MonitorEvent`) hold references only (company, search, round ids) — unique
  `(searchId, companyId)` and `(userId, roundId)`. A company a search reported once is never
  reported by that search again, even after monitoring is turned off and on. `UpdatesService.
  resolve` re-gates every event for the reader's current access and policy at render (follows
  `mergedIntoId`; drops non-approved rows, deleted or unmonitored sources, and any round unless
  `companyRounds` is **full** for the reader; `gateFields`/`gateRowFields`), and shows one match
  per (search, canonical company). Feed: `GET /auth/me/updates` (newest first, 25, max 100). Copy
  says "Newly recorded funding" with the round's own date; 0 with no local amount reads
  "Undisclosed", never "$0".
- **Weekly digest** (`DigestService`, `MONITORING_EMAIL_ENABLED`, `MONITORING_DIGEST_CRON`, UTC;
  independent of `MONITORING_ENABLED`): opt-in `PUT /auth/me/digest` (`User.digestOptInAt`; needs a
  verified address). `updateProfile` clears it on an email change. One `MonitorDigest` per user per
  UTC ISO week, holding the frozen subject/html/text. Its window runs from the previous digest
  (or opt-in, at most 7 days back) to the assembly time, newest 50 visible events, none → no row.
  The dispatcher (every 5 min, up to 4 min of 10-row batches) re-checks eligibility (opted in
  before assembly, verified, unbanned, unlocked) and sends with key `monitor-digest/<id>` and
  `List-Unsubscribe` / `List-Unsubscribe-Post`. Retries 429/5xx/timeouts at 1 m, 5 m, 30 m, 2 h,
  8 h; it stops after 6 attempts or 23 h from `firstAttemptAt` (persisted before the first request,
  inside Resend's 24 h key window) → `failed`. It never resends a `sent` or `failed` row; a row
  never attempted within 7 days is `skipped`. The body is frozen, so a retraction after assembly
  may still go out — the documented delivery boundary.

**`GET /companies/featured?limit=`** (default 8, max 24) is the landing shop window. There is
no page-view tracking, so popularity is a score over data already held — saves ×5, approved
investor holdings ×3, non-grant rounds ×1 (each capped), +4 for a round in the last 18 months,
+3 for a known valuation — with `domain <> ''` required so every row has a logo. The top
`FEATURED_POOL` (120) ids are cached in-process for 15 min (`loadFeaturedPool`), and each call
draws a fresh Fisher–Yates shuffle (a signed-out viewer draws only the pool's non-partner-only
rows, with partner fields masked); the web fetches it `no-store` so every visit differs. Tune
the weights there. It carries only the default throttle and the web deliberately sends no
`forwardedForHeaders()` (see Rate limiting below): one page view is one cheap call, already
limited by nginx's `general` zone.

**`GET /search?q=`** (`src/search/`) answers the header typeahead in one call: three
parallel raw `$queryRaw` queries (Prisma can't order by a CASE), each matching **name only**,
ranked exact → prefix → word-start → substring, `LIMIT SEARCH_GROUP_LIMIT` (5), **no counts**,
plus one `PersonRole` lookup that labels each person with their latest public role's
organisation. Each query restates its public filter from `public-filters.ts` inline (keep them
in step), and the input is LIKE-escaped (`escapeLike`). Under `SEARCH_MIN_CHARS` it returns
empty groups without touching the DB; over `SEARCH_MAX_CHARS` is a 400. `@SearchThrottle()`.
Optional auth: signed out, the queries add `NOT "partnerOnly"` / `NOT "identifierOnly"` and null a
partner-marked domain or sector (read gate rule 2).

**Rate limiting (`src/throttle/`).** `@nestjs/throttler` is a global guard
(`ApiThrottlerGuard`, provided in `AuthModule` because it decodes the JWT), the backstop
behind nginx. It is in-memory, so it assumes one API process. Limits live in
`throttle.ts`: `DEFAULT_LIMIT` 300/min on every route, `@AuthThrottle()` 20/min on
login/register/forgot/reset/verify-email, `@SearchThrottle()` 60/min on the four directory
lists and `/search`, and `@SkipThrottle()` on `/health`. The key is `user:<id>` for a valid JWT, otherwise
`req.ip`. Admins (re-checked against the row) are exempt. `main.ts` sets Express
`trust proxy` from `TRUST_PROXY`, which defaults to the private and loopback ranges, so
`X-Forwarded-For` is believed only from the web container.

The web forwards the visitor's IP (`X-Real-IP` from nginx → `X-Forwarded-For`,
`apps/web/lib/client-ip.ts`) on **every non-GET `apiFetch`** and the login/register route
handlers. It **never forwards it on cached reads**: the header would become part of Next's
fetch-cache key. So the guard **skips a GET from a trusted proxy that carries no
`X-Forwarded-For`**. Those reads are already limited by nginx. A new uncached read that
should count passes `forwardedForHeaders()` itself, like `app/api/companies/search`.
Client components import the 429 text from `lib/rate-limit.ts`, never from `lib/api.ts`,
which is server-only.

**Public API (`/v1`, `src/v1/`).** `V1Module`'s three controllers (read, write, admin) are the
API's **entire** public surface — nginx forwards `/v1/` and nothing else. They call the
website's own services and DTOs, so validation, `attested`, attribution, citations and
visibility are identical. Auth is a **personal API key** only (`Authorization: Bearer cbk_…`;
`ApiKeyGuard`, via `@ApiKeyAuth()`/`@AdminKey()`): a JWT is refused on `/v1` and a key
everywhere else. `ApiKeysService` (`src/api-keys/`) mints `cbk_<8 base62>_<43 base64url>`,
stores only the sha256 (`ApiKey.hash`; `prefix` is the lookup handle) and on every request
checks: unrevoked, owner unbanned, owner's **current** role still permits the key's scope
(`scopesForRole` in `@repo/api` — the scope is a ceiling), owner verified (admins exempt,
`EMAIL_UNVERIFIED`), and the request IP inside the key's `allowedCidrs` (Node `BlockList`,
IPv4-mapped addresses normalised). 401 for a dead key, 403 for scope/IP/unverified. A key
**is** its owner: `RequestUser` gains `apiKey { id, scope, prefix }`, so every service call,
the pending cap and revisions work unchanged. Writes use `@KeyContribution()` (the
`PendingCapGuard`, at `MAX_PENDING_API_SUBMISSIONS` 500 for key traffic) — no Turnstile.
Contributor-key writes land PENDING; **admin-key writes are published** by `V1WriteService.publish`
calling `AdminService.moderate(…, 'APPROVED')` right after the create — two steps, not one
transaction: if the approval fails the row stays PENDING (500 naming its id). Admin keys also get
`GET /v1/submissions` + `POST /v1/submissions/:type/:id/approve|reject`; no deletes, merges, bans,
roles or suppression over `/v1`. `GET /v1/companies?domain=` is an exact host match
(`normalizeDomain` in `@repo/api`; contributed domains are stored normalised; indexed) for
de-duplication. Keys are managed with JWT routes `GET|POST /auth/me/api-keys`, `DELETE
/auth/me/api-keys/:id` (`MAX_ACTIVE_API_KEYS` 5); `AdminUsersService.update` revokes keys in the
role/ban transaction (`revokeForRole`). **Extraction limits** (per account, never per key): the
throttler keys a key on `owner:<userId>` (never admin-exempt, never skipped as an internal read;
not `user:` so the owner's own JWT traffic never eats into it), and `V1ReadThrottle`/
`V1WriteThrottle` pass a route-independent `generateKey`, so every `/v1` read route shares one
bucket (`v1-read`) and every write route another (`v1-write`), sized by the requesting key's
scope from `API_KEY_LIMITS`. A second named throttler, `daily` (`V1_DAILY_THROTTLER`, registered
in `AppModule`'s `forRoot`), counts every live-key request against `API_KEY_DAILY_LIMITS`
(contributor 10k, admin 50k) in a **sliding** 24 h window (`blockDuration: 0` — the library
default would lock the account out for a day); its `skipIf` passes anything without a resolved
key scope, so website, JWT and dead-key traffic never hold a daily window. Its 429 carries
`DAILY_QUOTA_MESSAGE` and a plain `Retry-After` (`ApiThrottlerGuard.throwThrottlingException`).
The four `/v1` lists also stop at row `MAX_V1_LIST_DEPTH` (10k, `page × pageSize`, 400 past it —
`src/v1/list-depth.ts`); the website's directory routes share the DTOs and stay uncapped. The
guard and throttler share one key lookup per request.
**OpenAPI**: `setupApiDocs` (`src/v1/docs.ts`, called in `main.ts`) serves Swagger UI at
`/v1/docs` and the document at `/v1/openapi.json`, public, `include: [V1Module]` only. Bodies and
query params come from the DTO classes through the `@nestjs/swagger` CLI plugin (`nest-cli.json`;
`test/swagger-plugin.js` does the same for e2e) — so `apps/api` pins the **same TypeScript as the
hoisted root** (the plugin loads the root copy; two versions crash the transformer). Responses are
described per route with `@ApiOperation`/`@ApiOkResponse`. Guide for callers: `/developers`.

**Company claims** (`src/claims/`; plan `thoughts/shared/plans/2026-11-12-company-claims-and-verified-representatives.md`).
A signed-in user proves they work at a company and becomes its **verified representative**. A claim
is a **relationship, not a role and never a reviewable type**: it moderates nothing, it is not one
of the nine contribution tables, and **`accessFor` never reads it** (an active claim with no
approved contribution stays locked — the e2e suite pins it). What it buys: the queue label and
filter, a revision marked as a representative edit, the profile mark, and "confirm still current".
Representatives stay **moderated** — no auto-publish, no fast path; an approved representative edit
does not clear `partnerOnly`.
- **Two ways in.** `EMAIL`: `POST /companies/:slug/claim/email` (`JwtAuthGuard`,
  `VerifiedEmailGuard`, `TurnstileGuard`; not a contribution, so no pending cap) mails a
  single-use link (`CompanyClaimToken`, the `EmailVerificationToken` pattern: sha256 only, 24 h,
  conditional `updateMany` spend, bound to user + company + address) to the **work** address —
  always, even when the account's own address is at the domain (the `email_verification` backfill
  marked old users verified without a link). `claim-verify` carries no user-written value (a third
  party's mailbox). `POST /claims/verify` (public, `@AuthThrottle()`) re-reads the company and
  re-runs the domain rule against its **current** domain, so a link for a company merged or
  re-domained since is refused. `MANUAL`: `POST /companies/:slug/claim/request` (same guards; note
  `CLAIM_NOTE_MIN..MAX`, optional `@IsUrl` evidence, `@Equals(true) authorised`) creates an
  undecided row an admin approves or rejects at `/admin/claims` (`AdminClaimsController`,
  `@Roles('ADMIN')`: list, `count`, `approve`, `reject` with an unstored reason, `revoke`).
  Spending a link or approving a request stamps `claimId` on the user's still-PENDING rows for that
  company. Owner routes: `GET /companies/:slug/claim` (`CompanyClaimView` — `emailClaim`, never the
  domain), `GET /auth/me/claims`, `DELETE /auth/me/claims/:id` (withdraw; another user's id 404s),
  `POST /companies/:slug/claim/confirm`. No `/v1` claim route (a key acts as its owner, so a key
  owner's submissions are labelled like their website ones). Every change emails the **account**
  address (`claim-notice`).
- **The domain rule.** `claimableHost` (`claims/claimable-domain.ts`): the company's domain as
  lower-case ASCII (punycode, `node:url` `domainToASCII`), or null — no domain, a social /
  platform / free-mail host (`@repo/api` `domain/domains.ts`), or a bare public suffix (`tldts`
  `getPublicSuffix(…, { allowPrivateDomains: true })`: `co.uk`, `github.io`). `claimDomainMatch`:
  the address's host equals the stored host **or is a subdomain of it**; the parent of a stored
  subdomain, a lookalike and a suffix without a dot boundary never pass. A mismatch is `400 {
  code: CLAIM_DOMAIN_MISMATCH }`, no domain `400 { code: CLAIM_EMAIL_UNAVAILABLE }`.
  Partner-only companies can be claimed; their domain is only ever a match key.
- **One definition of active**, `claims/active-claim.ts`: verified, not revoked, user not banned,
  company not merged away, and for `EMAIL` the company's current domain (`normalizeDomain`) still
  equals the one it was verified against. **Evaluated live everywhere** — nothing is stamped when a
  domain changes, so a retracted domain edit restores the claim (status `suspended` meanwhile);
  `MANUAL` ends only by revocation, withdrawal or a ban. `isActiveClaim` (TS), `activeClaimIds`
  (the same predicate in one raw query, `NORMALIZED_COMPANY_DOMAIN` restating `normalizeDomain`
  step for step — the e2e suite checks both agree on every fixture claim), `activeClaimId(user,
  company)`, `activeClaimsOn(company)`. A ban (`AdminUsersService.update`, same transaction as
  `rejectPending`) ends every claim (`endReason: 'ban'`) and expires unused links; unbanning
  restores nothing. Contested claims are fine: there is no `(userId, companyId)` unique key.
- **Where it shows.** Each of the seven company-anchored contribution writes (`addRound` …
  `proposeChange`, so `/v1` too) stores `claimId: activeClaimId(…)` (one indexed read). The queue
  (`listSubmissions`) labels a row `representative` only when its claim is active *now*
  (`fillRepresentatives`, one query per page, beside `fillReviewers`; the claim id stays off the
  payload); `?representative=1` resolves `activeClaimIds` once and adds `claimId IN (…)` to the
  seven tables — `company` and `investorProposal` are excluded like a type filter (count 0).
  Approval (`moderateRow`, `applyProposal`, inside the transaction) writes `Revision.claimId` only
  when the claim is active **at approval time** (for a proposal, against the domain before its own
  diff); the public `Revision.representative` is `claimId !== null` — never the id or the person.
  The detail read adds `activeClaimsOn` to its `Promise.all`: `representation { since,
  lastConfirmedAt }` (earliest verification, latest confirmation) and the viewer's own
  `viewerClaim { id, lastConfirmedAt, canConfirm }`; both null on a stub and with no active claim.
  Not a `FIELD_REGISTRY` fact and not gated. **Confirm** stamps `lastConfirmedAt` on the caller's
  active claim only (403 without one, 429 inside `CLAIM_CONFIRM_INTERVAL_HOURS`) — no Revision, no
  `Company` write, so `Company.updatedAt` never moves.
- **Limits** (`@repo/api` `domain/claims.ts`, counted from token rows like the MFA lockout;
  **admins are not exempt** — a claim is not moderation): one link per account per
  `CLAIM_COOLDOWN_SECONDS` (60), `CLAIM_ATTEMPTS_PER_USER_PER_DAY` (5),
  `CLAIM_ATTEMPTS_PER_COMPANY_PER_DAY` (10, bounds the mail one company's domain can be sent;
  accepted trade: accounts can exhaust it for a day, the manual path remains),
  `MAX_OPEN_CLAIM_REQUESTS` (3), all 429. A new link expires the user's older unused ones for that
  company (**expired, not deleted** — the rows are the counter); tokens older than 7 days are
  pruned on insert. The web forms are server actions under nginx `writes`.
- **Merges**: `companyClaim` is a `COMPANY_CHILDREN` entry (moved to the survivor, restored on
  unmerge); tokens are not remapped (refused at spend). `test/company-claims.e2e-spec.ts` is the
  suite (the mail provider faked to read the link; users through Prisma).

**Investor-firm edits** (`investorProposal`, a ninth reviewable type, `/v1` only — no web form):
`InvestorChangeProposal` holds an `InvestorEditFields` diff (`INVESTOR_EDIT_FIELDS` whitelist;
ADV facts are ingest-owned). `InvestorsService.proposeChange` drops unchanged keys (400 if
nothing is left, 404 for a hidden/merged firm). Approval (`applyInvestorProposal`) updates the
firm and stores the replaced values in `previous` inside the transaction — **no Revision and no
Citation** (a firm has no company timeline, and there is no firm-level citable type), so
`CitableType`/`RevisableType` exclude it. Every table enumeration (queue, counts, pending cap,
`listContributions`, ban sweep, digest) includes it; its emails link `/investors/<slug>` and a
rejection points at `/developers`. An ADV/Wikidata re-ingest may re-set an edited field.

Errors go to self-hosted GlitchTip via `@sentry/nestjs` (`src/instrument.ts`, imported
first in `main.ts`; `SentryGlobalFilter` reports 5xx, never 4xx). No-op without `SENTRY_DSN`.
The same pattern is in `apps/jobs` and, as `@sentry/nextjs` in `instrumentation.ts` plus a
lazily-loaded browser SDK (`lib/sentry-client.ts`), in `apps/web`.

## Database (packages/db, `@repo/db`)

Single source of truth for the schema. Holds `prisma/schema.prisma`, `prisma/migrations`,
`prisma/seed.ts`, `prisma.config.ts`, and the generated client (`src/generated`, gitignored).
`apps/api` and `apps/jobs` both import `@repo/db` (a thin `PrismaService` extends its
`PrismaClient`). Prisma 7 is Rust-free + uses `@prisma/adapter-pg`; the datasource URL lives
in `prisma.config.ts` (reads `DATABASE_URL`), not the schema. Money is `BigInt`. Contributable
Company/FundingRound rows — and the ingest-only `Fund` — also have
`externalSource`/`externalId` (`@@unique`) for idempotent ingestion. Run schema commands via `make` or `yarn workspace @repo/db <generate|migrate|seed>`.

**Partner provenance** (read gate rule 2): `Company`/`Investor`/`Fund`/`FundingRound` carry
`partnerFields String[]` — the columns whose current value the partner wrote — and
`Company`/`Investor`/`Fund` a `partnerOnly Boolean` (indexed; the row exists only because of the
partner). People use `Person.identifierOnly`, the same signal (the partner is the only
identifier-only source). `RoundInvestor.externalSource` says which source named a firm on a round.
Ingest maintains them (Jobs → PARTNER); `make backfill-partner-provenance` reconstructs them.

**Saved searches and monitoring tables** (migrations `saved_searches`, `monitoring`,
`monitoring_digest`, additive, all user rows cascade on user delete): `SavedSearch`, the monitor
columns on `SavedSearch`/`SavedCompany` (`monitoredAt`, `monitorStatus` `baselining | active |
unavailable`, `evaluatedAt`), `MonitorSeenCompany` (PK `(searchId, companyId)`), `MonitorSeenRound`
(PK `(userId, roundId)`), `MonitorEvent` and `MonitorDigest` (unique `(userId, weekStart)`,
`firstAttemptAt`), plus `User.digestOptInAt`. Seen rows are never pruned while their source exists.

**`FundingRound_date_idx`** (`("date")`, migration `round_screening_index`) serves the screening
financing window. Measured: a `(moderationStatus, kind, date)` index was equally fast with a kind
but unusable for a window without one; plans are recorded in
`thoughts/shared/plans/2026-11-11-advanced-company-screening.md` → Performance.

**Directory sort counts**: `Person.roleCount` / `Person.companyCount` and
`Investor.holdingCount` (indexed) are the `/people` and `/investors` sort keys and the "at
several companies" filter — the public count (`PUBLIC_ROLES` / `PUBLIC_HOLDINGS`, partner rows
included), stored because a relation-count sort GROUP BYs the whole child table per page.
`refreshDirectoryCounts(db, scope?)` (`@repo/db` `directory-counts.ts`) is the one set-based
definition and writes only changed rows (a re-run writes 0). Jobs run the full form at the end of
every `IngestService.run` (cron, monthly, backfills, partner stages — a failure is logged and
reported, never fails the run) and after `backfill-people` / `purge-sbir-people`; the API runs the
scoped form (`admin/directory-counts.ts`, never throws) after `AdminService.moderate` (a role's
person, a holding's firm, a company's people and firms) and every merge/unmerge. People cards
count live (cheap), so there a stale key only misorders; investor cards show `holdingCount`, so
there a stale key also shows as a wrong number until the next refresh. `make backfill-directory-counts` (`-prod`) fills
or re-runs it by hand.

**Ingestion routing and repair tables** (migration `company_repair`, additive, private — never
served by any API): `CompanyIngestBinding` (`(source, sourceCompanyId)` → company or a hold, with
whitelisted evidence and policy version), `IngestRoundBinding` (deal → canonical round, OWN/DEDUP),
`CompanyRepairRun` (unique `(databaseFingerprint, manifestHash)`, so repeating an apply resumes the
same run) and `CompanyRepairGroup` (the journal). Plain-id columns, no FKs to `Company`.

**Company-claim tables** (migration `company_claims`, additive): `CompanyClaim` (user, company,
`method` `EMAIL | MANUAL`, the verified `email` and `domain`, the request's `note` /
`evidenceUrl`, `verifiedAt`/`verifiedById`, `revokedAt`/`revokedById`, `endReason`
`withdrawn | revoked | rejected | ban`, `lastConfirmedAt`; indexed on `companyId`, `userId` and
`(method, verifiedAt, revokedAt, createdAt)` for `/admin/claims`; **PRIVATE** — `email`, `note` and
`evidenceUrl` reach only the owner and admins) and `CompanyClaimToken` (`(userId, createdAt)` and
`(companyId, createdAt)` serve the limits; `prod-cleanup.sql` drops them all). `claimId` (a plain
id, no FK, like `reviewedById`) on `ChangeProposal`, `FundingRound`, `PersonRole`,
`InvestorHolding`, `AcquisitionDeal`, `ExitEvent` and `DiversitySignal` (indexed, for the queue
filter) and on `Revision` (not indexed). Both cascade on user and company delete. No backfill:
older submissions are unlabelled, which is correct.

**Two-factor tables** (migration `mfa_passkeys`, additive): `User.mfaEnabledAt` (denormalised
"has a factor", so `JwtStrategy` enforces from the row it already reads), `totpSecret` (sealed),
`totpEnabledAt`, `totpLastStep`; `WebAuthnCredential` (passkeys: `credentialId` unique,
`publicKey`, `counter` BigInt, `transports`, `deviceType`, `backedUp`, `name`, `lastUsedAt`);
`RecoveryCode` (sha256 only, `usedAt`); `AuthChallenge` (the sign-in steps; pruned an hour after
expiry on each insert; `prod-cleanup.sql` drops them all from a dump).

**Moderation decisions**: every contributable table carries `reviewedAt` / `reviewedById`
(a plain id, not a relation — users are never deleted; `listSubmissions` names them with one
lookup per page), written by every decision path (`moderate`, the ban sweep `rejectPending`)
and indexed `(moderationStatus, reviewedAt, id)`. The `moderation_review` migration backfilled
them from the `CREATE`/proposal revisions, else `updatedAt` (reviewer unknown), so every
contributed decided row has a `reviewedAt`; ingested rows stay null. `ChangeProposal` /
`InvestorChangeProposal.clearedPartnerFields` records the partner marks an approval removed.

**Read-gate overrides** (migration `gate_policy`, additive; config, so `prod-cleanup.sql` keeps
them): `GateSectionPolicy` (`section` PK, `signedOut`/`signedIn`/`unlocked`, `previewRows`,
`partnerAudience`), `GateFieldPolicy` (`entity` + `field` PK, `audience`, `partnerAudience`) and
`SiteSetting` (`key` → JSON `value`; today `contributionWindowDays`). Plain-string columns
validated in the API; each row carries `updatedAt` and `updatedById` (a plain id, like
`reviewedById`). Empty tables are exactly the code defaults; deleting rows rolls a change back
without a deploy.

`ApiKey` holds personal `/v1` keys (owner, `scope`, unique `prefix`, sha256 `hash`,
`allowedCidrs`, `lastUsedAt` debounced to once a minute, `revokedAt`); `InvestorChangeProposal`
holds investor-firm edits (see Backend). `Company.domain` is indexed for `?domain=`.

`User.emailVerifiedAt` (plus `EmailVerificationToken`) gates contributions. The
`email_verification` migration backfilled every pre-existing user as verified
(`= createdAt`), so a seed `001` admin created on a fresh DB afterwards stays unverified —
harmless, admins are exempt.

**Seeding is phased** (Flyway-style): `prisma/seeds/` holds ordered `Seed` phases
(`001-admin-user` bootstrap, `002-demo-companies` demo, …) registered in `seeds/index.ts`;
`prisma/seed.ts` is the runner, applying only phases not yet recorded in the `SeedHistory`
table. `kind: 'demo'` phases need `SEED_DEMO=true` (set by `make db-seed`/`db-init` and the
compose seed profile); plain `seed` is bootstrap-only and safe on prod. To add seed data,
append a new `NNN-*.ts` phase (idempotent upserts, never `deleteMany`; never edit a shipped
phase). `make db-baseline` marks all phases applied without running (pre-runner DBs);
`make db-reset` is the explicit destructive wipe-and-reseed for local dev.

### Provenance: citations & revision history

Three tables make published facts traceable. **`Source`** is one primary document,
deduplicated by `url`. **`Citation`** binds a source to a fact: polymorphic
(`entityType` + `entityId`, one of `CITABLE_TYPES`) plus a `field` that is `''` for a
whole-row attestation or a column name for a field-level one. `field` is **non-nullable**
because Postgres treats NULLs as distinct, which would defeat the
`@@unique([sourceId, entityType, entityId, field])`. **`Revision`** is the append-only
change log, anchored to a company so one timeline covers the company row and every child.

`CitableType` is a **superset** of the reviewable types, not an alias for them: it is
`Exclude<ReviewableType, 'proposal' | 'investorProposal'> | 'fund'`. Funds are citable without being reviewable —
they are ingest-only, so widening it gives them citations without dragging them into
`countsByType` or `moderate()`. `RevisableType` (`apps/api/src/provenance/revision.util.ts`)
stays narrow.

- Revisions are written on **APPROVED transitions only** — `AdminService.applyProposal`
  captures the before-state *inside* the transaction (applying a diff destroys what it
  replaces), `moderate` writes a `CREATE` entry per newly published row, and
  `IngestService.writeCompany` records enrichment/own-key updates as `actor: 'INGEST'`.
  Rejecting a PENDING row writes nothing; it never became public. Rejecting an **APPROVED** one
  is a retraction and writes `RETRACT` entries (`field: ''` with the row as `before` and a
  JsonNull `after`; or, for an edit, one per restored field with the proposal's value → the
  restored one), rendered "retracted" / "<field> reverted" on the history page. A
  `company-match-repair` ownership correction writes `REPAIR` entries (`field: ''`, `after` a
  `RepairSummary`: `split-out` / `split-from` / `reversed`, the other company's name + slug and
  counts — never row ids), rendered "records separated to …" / "separated from …"; total or field
  corrections it proves are ordinary `UPDATE`s with `actorSource: 'PARTNER'`.
- Values entering `before`/`after` must go through **`toJsonValue`** (`@repo/db`):
  `BigInt` → `Number` (money columns would throw in `JSON.stringify`), `Date` → ISO, and a
  genuine null → `Prisma.JsonNull`, never bare `null` (which means SQL NULL, i.e. "not
  recorded" — a different fact).
- **History is not backfillable** — the old values were never stored. It starts empty.
- Citations *are* backfillable, because every source URL is derivable from identifiers
  already on the row: `make backfill-citations` (see Jobs below).
- The child domain types (`FundingRound`, `Person`, `InvestorHolding`, `AcquisitionDeal`,
  `ExitEvent`, `DiversitySignal`) expose `id` for exactly this reason — a citation must
  anchor to *this* round. `RoundInvestor` is excluded: no independent citable identity.

### Reports

**`Report`** holds visitor "Report an issue" submissions and is **never public**. Polymorphic
like `Citation` (`entityType` + `entityId`, `REPORTABLE_TYPES` = `IdentifiableType`, so
`'person'` is the human, not the role row); `entityId` is resolved from the slug **through the
public filters** at submission, so a hidden/merged profile can't be reported. Status is
`OPEN`/`RESOLVED`/`DISMISSED` (not PENDING — it is not a moderated row); reason, status and the
vocabularies live in `@repo/api` `domain/reports.ts`. Resolving writes only the note/link/who/when
— except `suppressPerson`, which sets `Person.suppressedAt` in the same transaction. `email` is
optional reporter contact (personal data, Privacy §2).

### Controlled vocabularies & entity metadata

**Investors are a first-class entity.** The `Investor` table holds ~7.4k firms (slug, type, HQ,
website, and for ADV rows CRD/CIK/fund count/gross fund assets); `InvestorHolding` and
`RoundInvestor` carry a nullable `investorId` pointing at it. Nullable only because seed phase
`002` shipped before the column existed and seed phases are immutable — every write path (ingest
and contribution) populates it, so treat non-null as an invariant. `/investors` and
`/investors/[slug]` read the table directly. **Most firms have an empty portfolio and that is
expected**: neither Form D nor Form ADV discloses investor→company edges (Form D names the issuer,
Form ADV the funds). Two sources do — Wikidata's ~1.5k P1951 statements, and **S-1
principal-stockholder tables** (`SEC_S1`), which name the firms owning a company about to
register. An S-1 edge is published only when the holder resolves to a firm the universe already
holds (`onlyIfKnown`): an ownership table carries no type signal, and `InvestorType` comes from
source structure, never from a name. Empty profiles still invite a contribution rather than being
hidden.

**People are a first-class entity.** The old `Person` child table was **renamed in place**
to `PersonRole` (migration `person_entity`, hand-written: `prisma migrate dev` emits DROP +
CREATE for a renamed model, which would have destroyed every row and orphaned every
citation). Its row ids are unchanged, which is why `Citation`/`ReviewableType`
`entityType: 'person'` still means **the role row** — the same overloading `'investor'`
already carries, where a citation means `InvestorHolding` while an identifier means
`Investor`. A new `Person` table holds one row per human (slug, `normalizedName`,
`mergedIntoId`, `suppressedAt`); `PersonRole` carries `personId`, `companyId` **or**
`investorId`, `role`, `kind`, `title`, `since`, `endYear`. `PersonRole.personId` is nullable
on the same grounds as `InvestorHolding.investorId` — seed phase `002` is immutable — so
treat non-null as an invariant.

Dedup is **identifier, then exact normalized full name**, in that order, through the one
`normalizePersonName` in `@repo/api` (shared so ingest and moderation can never drift). The
only identifier any source publishes for a human is the Wikidata QID, already embedded in
`PersonRole.externalId`. Name *variants* — `Adam Larson` vs `Adam J. Larson` — never
auto-merge: they become `MergeCandidate` rows scoped to one organisation, and `IdentifiableType`
now admits `'person'` so the whole merge queue works unchanged. A person merge writes **no**
`Revision` (`Revision.companyId` is required and a person spans many companies) and remaps
**no** citations (they anchor to the role row, whose id never moves). `suppressedAt` is a
column of its own, not `moderationStatus: 'REJECTED'`, because ingest auto-APPROVES and would
undo a rejection on the next cron run; a suppressed person 404s rather than 301s.

**`PersonContact` is PRIVATE.** A partner supplies a work email, phone and LinkedIn URL
for people at investment firms; they are stored one row per role (`roleId`, firm-specific) and
**never published** — no API mapper, `/v1` route, search, sitemap, export, admin view or Revision
reads them, and the partner's LinkedIn never goes into the public `PersonRole.linkedinUrl`. The
only API code that touches the table is the suppression delete (`PeopleService.setSuppressed`
and the report "Suppress & resolve", both in the same transaction as the suppression) and the
person-merge remap (`MergeService`, ids only in `moved`). `test/contact-privacy.e2e-spec.ts`
seeds sentinel values and asserts no public response, site or `/v1`, carries one; keep it
passing, and keep `grep -rn personContact apps/api/src apps/web` to those three files.

**e2e cleanup rule:** never `deleteMany({ where: { id: maybeUndefined } })` — Prisma reads an
`undefined` filter value as NO filter, so a `beforeAll` that failed before assigning the id
deletes every row in the table (it emptied the local `User` table once). Guard with `if (id)`,
delete by the ids you created, and avoid `/auth` calls in new suites (throttled at 20/min
across the whole parallel run; create users with Prisma and mint keys via `ApiKeysService`). The read-gate policy tables are shared by every
suite's app (suites run in parallel), so a suite never writes a policy row that another suite's
assertions depend on: `gate-policy.e2e-spec.ts` stubs `GatePolicyService.current()` with a policy
from `resolveGatePolicy`, and its admin-route cases touch only `companyExits` /
`company.twitterUrl` and delete them at once. `PrismaService` disconnects on `app.close()`
(`onModuleDestroy`) — finished suites otherwise held their pools and the parallel run exhausted
Postgres's 100 connections. The full suite sits near that ceiling; run it with
`--runInBand` when a run fails on "too many clients". The monitoring suites call
`runOnce(now)` / `assemble(now)` / `dispatch(now)` directly and fake the mail provider with
`overrideProvider(MailService)`.

**Funds are a first-class entity too, and ingest-only.** `Fund` is one row per private fund
with a **required** `managerId` FK to `Investor` — a fund whose manager cannot be resolved
structurally is dropped, never written against a guess (measured: name-prefix guessing added
+0.8% coverage and its first hit was a false positive). Two SEC sources fill it and neither is
sufficient alone: Form ADV Schedule D gives the manager link (via CRD), the name, the strategy
and `grossAssetsUsd` — which is **NAV at filing time, not capital raised** — while pooled Form D
filings give `vintageYear`/`targetUsd`/`closedUsd` but never name the manager. They are joined on
the fund's normalized name (`normalizeFundName`, `ingest.service.ts`), and a name claimed by two
managers matches **neither** — 191 of 94,399 ADV fund names collide and they are degenerate
(`fund 5`, `94`). `targetUsd` is nullable because half to two thirds of pooled filings declare an
"Indefinite" offering; `0` would be a claim the filing never made. `Fund` keeps a
`moderationStatus` column so its read path matches its siblings, but nothing ever leaves it
`PENDING`, it never enters the admin queue, and it writes **no revisions** (`Revision.companyId`
is required and a fund has no company). Every fund has a page at `/funds/<slug>`: ingest mints
the slug on create (`ingest/fund-slug.ts`, shared with `make backfill-fund-slugs`, which gave
the pre-existing funds theirs; `Fund.slug` stays nullable until that has run everywhere). A
data partner adds what no filing reports: `status` (`FundStatus`), launch/latest/final close
dates, hard cap, management fee, carry, hurdle and target IRRs (percentages as published, null
when absent — never 0) and its **reported mandate and structure** (migration `fund_mandate`,
additive, nine columns): `detailedStrategy` (the published strategy label — not `strategy`, the
broad class), `industries[]`, `verticals[]`, `geographicFocus[]` (where it targets),
`geographicExposure[]` (where it reports exposure; usually includes the focus — a different fact),
`domicile` (a country or a US state, never `hq`), `structure`, `legalStructure` and
`mandateReportedOn` (the stage's snapshot date; the source dates no fund section). Labels are kept
as published (cleaned, never mapped onto `FUND_STRATEGIES`/`SECTORS`/`COUNTRY_CODES`); an empty
list or null was not reported; `regionFocus` stays the primary region. Ingest writes them on
create and own key, and an enrichment fills blank ones (an empty list counts as blank); an older
`mandateReportedOn` never replaces a newer one. No overview prose is stored (it needs a rewrite
first). `FundCommitment` (an LP `Investor` → `Fund`, money in the fund's
currency plus an ECB-converted `amountUsd`) and `FundMetric` (one per fund per as-at date) are
ingest-only and write no revisions; `FundCommitment` has **no** `(fundId, investorId)` unique,
so an investor merge keeps both rows (the `InvestorHolding` rule) and stays reversible.

**`InvestorFocus`** (migration `investor_focus`, additive) is what a firm **reports** it invests
in, one row per firm per role (`INVESTOR_FOCUS_ROLES`: `manager` | `lp`) — a historical statement
as of `reportedOn`, not a promise it is investing. The roles are different facts: a manager's
`geographies` are where it HAS invested (exposure, `geographicExposure` in the API), an LP's where
it WANTS to commit (`geographicPreferences`); a manager's range is its initial equity cheque, an
LP's its typical fund commitment. Labels are kept as published (cleaned, never mapped onto
`SECTORS`/`STAGES`/`InvestorType`; portfolio `sectors` stays a separate fact). Money is whole units
(`rangeMinUsd`/`rangeMaxUsd`, plus `rangeCurrency` + `rangeMinLocal`/`rangeMaxLocal` for a non-USD
firm), converted from the publisher's millions exactly once, in the parser; a null bound was not
reported, never 0. Partner-only, ingest-only, no `moderationStatus` (the parent firm and
`externalSource` decide visibility), no Revision, no Citation, no `partnerFields`. Ingest never
deletes a role a later snapshot lacks, and an older `reportedOn` never replaces a newer one. It is
an `INVESTOR_CHILDREN` merge entry: both firms' rows survive a merge (the detail read takes the
newest per role) and an unmerge restores them.

Controlled vocabularies are TS string-literal unions + a `readonly` const array in `@repo/api`
(`domain/company.ts`), stored as plain `String` columns and validated in DTOs with `@IsIn([...])`
— not Prisma enums. `InvestorType` covers `Venture`/`Growth`/`Angel`/`Corporate`/`Private equity`/
`Accelerator`/`Hedge fund`/`Sovereign wealth` — the last three are derived from source *structure*
(Wikidata P31 class, ADV fund-type columns), never guessed from the firm's name — plus the
limited-partner types `Pension fund`/`Endowment`/`Foundation`/`Family office`/`Insurance`/`Bank`/
`Wealth manager`/`Asset manager`/`Fund of funds`/`Government`, read from a data partner's closed
firm-type field (`sources/partner/partner.parser.ts` `firmType`).
`FundStrategy`/`FUND_STRATEGIES` (`Venture capital`/`Private equity`/`Hedge fund`/`Real estate`/
`Securitized asset`/`Liquidity`/`Other`) is read the same way — both SEC sources publish a fund
type as a *structured field*, so the two publisher vocabularies are renamed into one canonical
set, never inferred from a fund's name. **`PersonRole.kind`** (`RoleKind`/`ROLE_KINDS`: `Founder`/`CEO`/`Executive officer`/
`Director`/`Promoter`) is read the same way — only from a *closed publisher vocabulary*:
Form D's `relationship` enum and Wikidata's property identity (P112 founder, P169 CEO).
Null for Form C, whose signature-block roles are free prose, and for SBIR, where
`Principal investigator` is a role on a grant rather than at the company. Never inferred by
reading a title string. `Stage`/`STAGES` opens with
**`Bootstrapped`** (no outside funding): human-written only — no source can state that a company is
unfunded, so no source emits it, and the profile's empty Funding rounds block says so instead of
"No rounds recorded yet". Besides
`Stage`/`CompanyStatus`/`InvestorType`/`ExitType`/`FundStrategy`, there is a
**`Sector`/`SECTORS`** vocabulary (14 canonical sectors: the original `Artificial intelligence`/
`Fintech`/`Healthcare`/`Climate`/`Enterprise SaaS` plus `Technology`, `Financial services`,
`Energy`, `Real estate`, `Industrials`, `Consumer & retail`, `Transport`, `Media & telecom`,
`Education`) shared between `Company.primarySector` and `MarketStat.sector`. This is the
connection between companies and the sector tape; market stats (`MarketStat`/`MarketTotals`)
are **computed live** by the API's `MarketService` from approved Company/FundingRound rows —
there are no seeded market tables. Two small status vocabularies also
exist: `OperatingStatus`/`OPERATING_STATUSES` (`Active`/`Closed`) and `CompanyType`/`COMPANY_TYPES`
(`For profit`/`Non-profit`).

Entities carry optional outbound-link / metadata fields (all nullable, `@IsUrl`-validated where a
link): `Company` — `websiteUrl`, `linkedinUrl`, `twitterUrl`, `legalName`, `operatingStatus`,
`companyType`, `primarySector`; `Person` — `linkedinUrl`, `title`; `InvestorHolding` —
`websiteUrl`, `linkedinUrl`. They render as outbound links / facts on the company profile.
SEC rows get `primarySector` via the deterministic Form D map
(`apps/jobs/src/sources/sec-edgar/sector-map.ts`); Wikidata and SBIR rows via the `SECTOR_RULES`
keyword heuristic (SBIR falls back to `AGENCY_SECTOR_MAP`, which is null for the agencies that fund
every sector). Form C has no industry field, so those rows are honestly unclassified.
`make backfill-sectors` fills missing sectors from stored `industry[]`.

**Geography and currency.** `Company.countryCode` / `Investor.countryCode` hold an ISO 3166-1
alpha-2 code (`COUNTRY_CODES`, `normalizeCountryCode`, `countryCodeFromName` in `@repo/api`
`domain/geography.ts`; the 249 officially assigned codes, `UK`→`GB`/`EL`→`GR` aliased). `hq` stays
the display string; `countryCode` is the filterable fact, set **only when a source states a
country structurally** — an EDGAR location code (`sec-edgar/edgar-locations.ts`; `GEORGIA` as a
description reads as the US state), a Form ADV dropdown, Wikidata's P17→P297, SBIR (US by statute),
Innovate UK/Companies House (GB by construction) — never read off a city name. Contributed and S-1
rows stay null. `make backfill-geography` (`ingest/derive-country.ts`, no network, re-runnable,
no revisions) derives it for rows that predate the column. `/companies` and `/investors` filter on
`?country=` (`@IsIn(COUNTRY_CODES)`, so an unassigned code is a 400) and `GET /companies/countries`
/ `GET /investors/countries` return the `CountryFacet[]` the filter lists (15-min in-process cache).
`FundingRound.currency` (ISO 4217, default `USD`) + `amountLocal` (the published amount, null for
USD) carry a non-USD round; `amountUsd` is the FX-converted comparable figure (ECB reference rate on
the round's date, `apps/jobs/src/util/fx.ts`) and is what every sort, total and bar width reads.
Every other money column stays USD-only.

**`FundingRound.kind`** (`Equity | Debt | Grant`, `ROUND_KINDS` in `@repo/api`) says what sort of
capital a round is. Grants — SBIR/STTR awards — are real capital events but not raises, so they are
excluded from `Company.totalRaisedUsd` (the SBIR source writes 0) and from `MarketService`'s deal
count (`AND r."kind" <> 'Grant'`), while still rendering on the Funding Ladder with a mono badge.
The column is ingest-only: it defaults to `Equity` and no contribution form sets it.

## Jobs (apps/jobs)

NestJS worker (port 3002, health endpoint) with ten pluggable `IngestionSource`s
(`src/sources/`, add OpenCorporates etc. later). A source contributes a
`NormalizedRecord` whose `rounds[]` is **plural** — a Reg CF issuer runs several offerings and an
SBIR grantee wins many awards, and one record per round would re-run the company upsert and let the
last one clobber `totalRaisedUsd`:

- **SEC_EDGAR** — Form D filings (free, official source for US private-placement
  funding). Walks N days of daily indexes (`INGEST_DAYS`), **keeps pooled
  funds/SPVs out of `Company`** by default (`INGEST_SKIP_FUNDS`), keys D/A
  amendments to the original filing's accession, and extracts
  executives/directors from `relatedPersonsList`. Pooled filings — ~63% of the
  feed — are **routed to `Fund`** rather than dropped: they carry the vintage,
  target and capital closed that Form ADV never asks for. Client sets
  `SEC_USER_AGENT`, throttles ≤10 req/s.
- **WIKIDATA** — enrichment for the ~6.4k notable companies carrying investor
  (P1951) statements: metadata (website/LinkedIn/HQ/sector), investors,
  founders/CEOs, acquisitions, exits. Throttled ~1 req/s SPARQL
  (`WDQS_USER_AGENT`, defaults to `SEC_USER_AGENT`). No funding rounds. Also
  enumerates ~640 **investor firms** by P31 class (`investor-class-map.ts`),
  independent of any P1951 edge, and runs the *same* `peopleQuery` over their QIDs
  for the firms' own officers. That query requires `?person wdt:P31 wd:Q5`
  **inside each UNION branch**: P112's range includes organisations (Bloomberg Beta
  is "founded by" Bloomberg L.P.), and placed after the UNION the planner scans
  every human on Wikidata and WDQS times out.
- **SEC_ADV** — the investor universe: ~7k VC/PE firms from the monthly Form ADV
  bulk files (name, CRD/CIK, HQ, website, fund counts, gross fund assets). A
  *monthly snapshot*, so `days` is ignored and it stays off the daily cron; pin a
  month with `ADV_SNAPSHOT` for a reproducible run. Contributes **no** company
  records — Form ADV never names portfolio companies.
- **SEC_ADV_FUNDS** — the private funds themselves: ~95k rows across ~5.5k
  managers from Form ADV **Schedule D 7.B.(1)**, with strategy and gross asset
  value. That table is *not* in the monthly roster: it ships in the Form ADV
  Part 1 data archives on the SEC FOIA page (700 MB + 429 MB, scraped for the
  link, `ADV_ARCHIVE` pins a cut), read by **HTTP range request** —
  `util/zip-range.ts` fetches the central directory from the archive tail, then
  just the four members it needs (~180 MB) and inflates them through
  `createCsvParser`. Member names must be anchored precisely: the archives ship
  ~15 `*_7B1A*` sub-tables that sort *before* `*_7B1_`, and the IA base file is
  split with only `_A` carrying `1E1` (the CRD). Schedule D has **no inception
  date and no fund size** — those come from Form D. A frozen archive
  (2011-11-05 → 2024-12-31), so it stays off the daily cron.
- **SEC_FORM_C** — ~9k Regulation Crowdfunding issuers from the 41 quarterly DERA
  data sets (`FORM_C_MIN_QUARTER` bounds the walk), with website, HQ, incorporation
  year, headcount and signing officers. The offering identity is `FILE_NUMBER`, not
  an accession — one offering can have up to 13 `C-U` progress updates. **The amount
  raised is not a column**: it is prose on the `C-U`, extracted by
  `progress-update.ts` (keyword-anchored and capped by the registered maximum), and
  an offering with no parseable amount deliberately gets **no round**. The TSVs are
  line-splittable — verified across all 268 members — unlike the ADV CSVs.
- **SBIR** — ~15k deep-tech companies and ~124k federal research awards from
  SBIR.gov's monthly bulk CSV (the documented JSON API 403s). Identity is UEI → DUNS
  → name; `SBIR_MIN_YEAR` (default 2015) keeps a firm on any recent award and then
  ingests its whole history. Every award is `kind: 'Grant'` with `totalRaisedUsd: 0`.
  People come from **`PI Name`**, not `Contact Name`: the contact column is populated
  almost only for DoD/NASA awards and names the federal desk that processed the grant,
  which put 10,963 NSF program directors in the corpus (`make purge-sbir-people` is the
  one-shot correction for a database that predates the fix).
  The 91 MB file is **streamed**, never buffered (`util/csv.ts`'s `createCsvParser`),
  and aggregated per firm as rows arrive.
- **SEC_S1** — investor→company edges from S-1 principal-stockholder tables, found
  via EDGAR full-text search (`S1_START_DATE` bounds the walk). `ownership.parser.ts`
  anchors on the section heading rather than "any table with a % column" (that finds
  the table of contents) and scores each row on structural signals only
  (`S1_MIN_CONFIDENCE`, default 0.6). Contributes **no** rounds and no money — an S-1
  says who owns the company, not what it raised.
- **INNOVATE_UK** — the UK analogue of SBIR: every business that took Innovate UK money
  since 2004 (~20.9k companies, ~44k awards), from the two workbooks behind UKRI's
  "funded projects" page (scraped for the links; the file names change). Keyed **only** on
  the participant's Companies House number (`CRN`) — no name fallback. Businesses only
  (`Enterprise Size` Micro/Small/Medium/Large; universities, PSOs, RTOs, Catapults dropped).
  `Participant Withdrawn From Project` = `Closed` means **finished**, not withdrawn (half of
  all real awards) — only the withdrawn states and `Pending` are dropped. Awards land as
  `kind: 'Grant'` in GBP with the ECB-converted `amountUsd`; the few `Innovation Loans` land
  as `Debt`. The xlsx is read by `util/xlsx.ts`, a streaming regex reader — the new-file sheet
  is ~96 MB of XML and a DOM parse would not fit the worker.
- **COMPANIES_HOUSE** — the UK register's large-company slice from the monthly Free
  Company Data Product (one ~494 MB zip, ~2.8 GB CSV, 5.7M rows), read by HTTP range
  request through `util/zip-range.ts` like the ADV archives and **streamed**: only kept
  rows are materialised. Kept = active Private/Public Limited Companies filing FULL /
  GROUP / MEDIUM accounts (~90k), **plus every company number already held**
  (`FetchOptions.knownCompanyNumbers` — grantees, Wikidata P2622) whatever its size.
  `CH_SNAPSHOT=YYYY-MM-01` pins one; otherwise this month, then last month. Sector from
  `SICCode.SicText_1` via `companies-house/sic-sector.ts` (deterministic; holding
  companies and fund vehicles stay null). `stage` is `Public` for a PLC, `Late stage` for
  the size slice, `Seed` for a known small company. No rounds, no people.
- **PARTNER** — a bulk snapshot from a partner (firms — managers and LPs — with
  their people, funds with terms, portfolio companies with deals, LP commitments, fund
  metrics). **The partner is never named** anywhere in code, docs or public copy: the tag,
  identifier scheme (`PARTNER`, in `HIDDEN_SCHEMES`), env, Make targets and public label all
  say "partner". The snapshot is loaded into the capbase DB as its own `partner_stage` schema
  (`make partner-stage-load FILE=…`, dropped after with `make partner-stage-drop`; Prisma
  manages `public` only) and read by `PartnerClient` over the same `DATABASE_URL`. It
  **streams** (`IngestionSource.stream` → `SourceBatch`es applied firms → funds → records →
  commitments → metrics) because it is far larger than the heap, and runs **one stage at a
  time** (`make ingest-partner STAGE=firms|funds|companies|commitments|metrics`, env
  `PARTNER_STAGES`); a stage run before its prerequisite skips and counts the edges it cannot
  resolve. `explicitOnly`: never part of `SOURCE=all`, never on a cron. Edges are id-keyed
  (`SourceFirmRef`/`SourceFundRef`): resolved by provenance key, then by the `PARTNER`
  identifier (a matched firm keeps its own key), never by name. Partner people are
  `identifierOnly` (resolved by contact id only — 20k names collide across firms — and never
  registered for name matching). Partner records set `roundDedup: 'enrich'`: a deal that is a
  near-duplicate (`ingest/round-dedup.ts`: ±120 days, ±25% amount, grant only with grant) of
  another source's round on a matched company is not written; its investors attach to the
  existing rung, and an **ingested** round (never a human one) is corrected — stage name over
  a placeholder, the partner's date, a missing amount — with a Revision each; a matched
  company's total is raised, never lowered. Partner facts carry **no citation** (the em
  dash), and `publicIngestLabel` (`@repo/api` `provenance.ts`) maps every internal
  `actorSource` to a public label (`PARTNER` → `partner`, unknown → `automated`), so the
  history page never shows a raw tag. Round correction needs a **strong** company match — an
  identifier in someone else's scheme, or a domain; a hit on the partner's own record id
  (`SOURCE_RECORD_SCHEMES`, which ingest attaches to whatever it matched, possibly by name)
  only repeats an earlier decision and never rewrites. Partner people carry
  `Person.identifierOnly` and are left out of every name map (ingest's `byName`,
  `backfill-people`'s name pass, both person variant sweeps — `IDENTIFIER_ONLY_SOURCES` in
  `person-matcher.ts`), so a later Form D "John Smith" never attaches to one.
  **Provenance writes** (what the read gate hides): a partner **create** sets `partnerOnly` and
  lists every column the record stated in `partnerFields` (`createdProvenance`); a partner
  enrichment / own-key update / raised total / round correction appends the columns it wrote
  (`provenanceUpdate`, `syncPartnerFields`; round corrections mark only columns whose value
  moved); **any other source** landing on a partner-only row makes it public record
  (`partnerOnly: false` — company/firm/fund matches, and a holding or round investor resolving a
  partner-only firm via `InvestorIndex.partnerOnly`), and a non-partner own-key overwrite takes
  the columns it wrote out of `partnerFields`. Partner re-runs never remove a mark (fail closed);
  an approved human edit does (`AdminService.applyProposal` / `applyInvestorProposal`).
  `writeRoundInvestors` tags rows with `externalSource`, deletes only its own source's rows, and
  never writes a firm another source (or a contributor) already named on the round. **`make
  backfill-partner-provenance`** (`-prod`; `ingest/partner-provenance.ts`) reconstructs the marks
  for data loaded before ingest recorded them — it needs `partner_stage` loaded (it compares stored
  values to what the partner stated, failing closed: an equal public value is marked too), is
  idempotent (a second run changes 0 rows), and must run before any further partner stage and
  before `partner-stage-drop`.
  **Stage versions.** `partner_stage.meta(stage_version, snapshot_date, built_at)` marks a stage;
  none means v1. v2 adds `partner_stage.firm_focus` (one row per firm per role, amounts in
  millions as published); `PartnerClient.stageContract()` reads the version and
  `requireFocusColumns()` checks every `FIRM_FOCUS_COLUMNS` column **before any write** (the firms
  stage throws on a v2 stage missing one; a v1 stage logs "investor focus not staged" and runs as
  before). The parser (`toFirmFocus`) drops junk labels, `0` bounds ("no bound"), and the whole
  range when a bound is negative, above `FOCUS_RANGE_MAX_USD` ($10bn — unit errors) or inverted.
  v3 adds `partner_stage.fund_mandate` (one row per fund; industries/verticals split on `;` because
  their labels contain commas, geographies on `,`): `requireMandateColumns()` checks every
  `FUND_MANDATE_COLUMNS` column before any write (a v1/v2 stage logs "fund mandate not staged"),
  `toFundMandate` cleans it (`geographyLabels` re-splits a nested `;` list and collapses the doubled
  `SAR - China`; a `Commingled`/SMA value in the legal-structure field is dropped as misfiled), and
  the **funds stage** writes it on create, own key and enrichment — so `STAGE=funds` alone is the
  rollout, with no backfill CLI. `make test-fund-mandate-integration` is its real-Postgres suite.
  **Focus association** (`focusAssociation` / `IngestService.writeInvestorFocus`): only the
  partner's OWN firm row (looked up by provenance key) or a firm with the same identifying domain
  receives focus — checked on the row, never on the path that found it, because an identifier the
  partner attached through an earlier name match would otherwise vouch for itself. A name-only
  association writes nothing (`weak`); admin merges are followed to the survivor. **`make
  backfill-partner-investor-focus`** (`-prod`; `ingest/partner-investor-focus.ts`) writes focus
  from a loaded v2 stage **without a firms re-run** (no firm column, person or contact touched),
  under the ingest lock, idempotently (a second run writes 0); it refuses a v1 stage (exit 1).
  `make test-investor-focus-integration` is its real-Postgres suite.
  **Index memory** (the 1 GB jobs container, ~549 MB heap): `IngestService` loads its four
  match indexes **lazily** (a stream batch loads only what it writes against), **paged**
  (`eachPage`, 20k rows; tombstones resolve from the merged rows alone), and leaves a record
  source's own ids and provenance keys (`SOURCE_RECORD_SCHEMES`/`wantKey` — ~770k identifiers,
  ~360k keys) out of every run that does not include that source. Measured on the full local
  dataset: ~450 MB of indexes for a public-source run, the daily Form D run peaking at ~700 MB
  RSS; before these changes it OOM'd. Re-measure before adding another bulk source.

The `@nestjs/schedule` cron (`CRON_SCHEDULE`) runs `INGEST_SOURCES` (default
SEC Form D only). A second, **monthly** job (`MONTHLY_CRON_SCHEDULE`, default `0 3 10 * *`)
runs `MONTHLY_INGEST_SOURCES` and then the citation pass in-process
(`ingest/citation-backfill.ts`, shared with the `backfill-citations` CLI); it is **not
registered at all while `MONTHLY_INGEST_SOURCES` is empty**, pings its own
`MONTHLY_INGEST_HEARTBEAT_URL`, and shares the daily job's `running` flag and lock. Every
other source is a snapshot run by hand. **A multi-source run follows `IngestModule`
registration order, not the env's order** — `INNOVATE_UK` is registered before
`COMPANIES_HOUSE`, and both after `WIKIDATA`, so the register sweep already knows every
number it must keep. Cron and `backfill.ts`
share a Postgres advisory lock (`ingest/ingest-lock.ts`, a dedicated `pg` client because
advisory locks are per-session): a cron tick skips while a backfill runs, and a backfill
exits 75 while the cron runs. Failed ingests are reported to GlitchTip; a cron run that
**succeeds** POSTs `INGEST_HEARTBEAT_URL` (a dead man's switch, no-op if unset), so a cron
that never fires alerts too. Failed and skipped runs send no ping. Backfills:
`make ingest DAYS=N LIMIT=N SOURCE=all|SEC_EDGAR|WIKIDATA|SEC_ADV|SEC_ADV_FUNDS|SEC_FORM_C|SBIR|INNOVATE_UK|COMPANIES_HOUSE|SEC_S1|PARTNER`
(→ `node dist/backfill [days] [limit] [source]`), plus `make ingest-investors`
(ADV + Wikidata firms), `make ingest-funds` (ADV Schedule D), `make ingest-uk` (Innovate UK →
Companies House) and `make ingest-all`
(everything, in a **forced order**: managers → their funds → the Form D walk that
dates and sizes them). All ingested rows — companies, rounds, the child entities
(people/investors/acquisitions/exits), standalone investor firms and funds —
upsert keyed on `(externalSource, externalId)` and are **auto-APPROVED** (trusted
sources). `IngestService` also **matches & enriches**: a
record whose company matches an existing row *structurally* (below) fills
that row's blank fields instead of creating a duplicate (never overwriting
name/stage/status or human-written copy — with one exception: a `Bootstrapped` row takes the
record's stage when the record carries an `Equity` round with a positive amount, since a filed
raise contradicts the claim; grants and debt never promote). The same match-and-enrich runs for
investor firms, keyed on domain then `normalizeInvestorName` (which strips legal
suffixes only — "Greylock Partners" and "Greylock Capital Management" are
different firms). Both name keys fold accents first ("Société Générale" → `societe generale`).

**A name never combines two companies.** The company identity policy is
`ingest/company-matcher.ts` (`decideCompanyMatch`, pure; policy version on every binding it
writes), strongest first: a private hold (`CompanyIngestBinding` REVIEW_REQUIRED) skips the record
whole; the record's own provenance key; a RESOLVED binding; legal identifiers, which must all name
one row (two rows → **conflict**: the record is skipped, a REVIEW_REQUIRED binding and an
`identifier` merge candidate recorded — never a first-target pick); a hit on the source's own
record-id scheme (`PARTNER`) that no binding confirms is a legacy alias that cannot vouch for
itself → **held**; a domain held by **exactly one** live row (column or DOMAIN identifier — not
first-wins) associates unless that row holds a different record of the same source, a different
`COMPANIES_HOUSE` number, or an uncertified partner alias (held); otherwise **create**. A name
match is only a review proposal: `companyIdentityKey` (strips at most one unambiguous legal form —
it keeps "Ag", so "Indigo Ag Inc." ≠ "Indigo"), country-compatible (`countriesCompatible`), at most
`NAME_CANDIDATE_LIMIT` holders → `name` merge candidates. The broad `normalizeName` survives for
review suggestions only. A structural match writes a RESOLVED binding (bindings resolve through
merge tombstones at index load, so admin merge/unmerge needs no binding rewrite). Ingest never moves
an owner: a record whose round/holding key already sits on another company is held
(`childOwnerClash`). `roundDedup` sources record each deal's canonical round in
`IngestRoundBinding` (OWN/DEDUP) and reuse it — a bound pairing is never re-derived from proximity,
and one whose rung is gone is skipped. Refusals are logged once per run ("Company identity: …").

**Repairing old mistakes: `company-match-repair`** (`src/company-match-repair.ts`,
`src/repair/`; runbook `docs/DATA_REBUILD.md` → "Repairing wrongly combined companies"). It reads a
private offline bundle (`scripts/prepare-company-repair-snapshot.py`: company/deal/deal_investor/firm
identity only, hashed, never people), groups every partner association into connected components
and plans **typed, allowlisted operations** (create a source-owned company, move rounds/holdings/
identifiers/child revisions by id, set a proved total or field, upsert bindings, append revisions —
no deletes of pre-existing rows, no SQL in the plan). audit/plan/verify use server-enforced
read-only `pg` sessions and boot no Nest context; apply/rollback need `EXPECT_DB` + `CONFIRM=yes`,
hold the ingest lock (75 if busy), take the owning-company `FOR UPDATE` locks, refuse a stale group,
and journal forward + inverse ops in `CompanyRepairRun`/`CompanyRepairGroup` in the same
transaction. Rollback refuses a group edited since. Make: `fix`/`fix-prod` (audit only),
`repair-company-matches[-prod] MODE=…`, `prepare-company-repair-snapshot`, `test-company-repair`,
`test-company-repair-integration` (task-owned throwaway DB), `check-company-repair`.

**Domains are a match key, so they must identify the entity.** `src/util/domain.ts`
classifies a URL host as identifying, social, or platform; sources publish a
`domain` only for the first kind. (The classifier itself lives in `@repo/api`
`domain/domains.ts`, with `FREE_MAIL_HOSTS` and `claimDomainMatch` for company claims;
`src/util/domain.ts` re-exports it so no ingest call site changed, and its spec moved to
`packages/api/src/domain/domains.spec.ts`.) This is not theoretical: 3,295 ADV filers list a
linkedin.com URL as their website and 21 list the same medium.com blog — matching
on those merges unrelated firms into one investor.

`make backfill-people` (`src/backfill-people.ts`, between `backfill-identifiers` and
`merge-candidates` in `ingest-all`) collapses the `PersonRole` rows into one `Person` per
human with **no network access** — the QID pass reads `PersonRole.externalId`, the name pass
uses `normalizePersonName`. The pure matcher lives in `ingest/person-matcher.ts` so it can be
tested without booting a Nest context. Idempotent: a role already carrying a `personId` is
skipped.

`make backfill-citations` (`src/backfill-citations.ts` → `ingest/citation-backfill.ts`, the
last step of `ingest-all`) mints `Source`/`Citation` rows for the whole corpus with **no network
access** — the URLs are constructed from stored identifiers via `sources/sec-edgar/edgar.urls.ts`,
`sources/sbir/sbir.urls.ts`, `sources/sec-s1/s1.urls.ts`, `sources/innovate-uk/innovate-uk.urls.ts`,
`sources/companies-house/companies-house.urls.ts` and
`sources/wikidata/wikidata.urls.ts` (CIK + accession → the Form D archive path, QID →
the Wikidata page, CRD → the IAPD firm summary, EDGAR file number → the Reg CF offering,
CIK → a filer's Form C / S-1 history, company number → the Companies House page, rendered
`[REG]` as `sourceType: 'Company registry'`). SBIR and Innovate UK have no derivable per-award
page, so those rows cite the **dataset itself** (`sourceType: 'Government dataset'`, rendered
`[GOV]`) with the contract / project number on the citation note. Idempotent, so re-run it after each
ingest. A row with no derivable URL is skipped and counted rather than given a guessed
link. `INGEST_RECORD_REVISIONS=false` turns off timeline writes for a from-scratch
rebuild (see `docs/DATA_REBUILD.md`).

Unit tests: `yarn workspace jobs test` (jest, pure parser/mapper/service specs).
Rebuilding the whole dataset from scratch, locally or on prod: **`docs/DATA_REBUILD.md`**.

## Deployment (Docker + Makefile)

Each app has a multi-stage `Dockerfile` (`turbo prune --docker`). `apps/web` uses Next
`output: 'standalone'`. Root `docker-compose.yml` runs postgres + api + web + jobs; the
api container runs `prisma migrate deploy` on boot, and a one-shot `seed` profile loads
demo data. Use the `Makefile`: `make up` (prod stack), `make dev` (local dev servers),
`make ingest` (run a backfill), `make help` for the full list.

**Production is a single VPS** (`make deploy-all`) serving `capbase.fyi` — the split
two-box topology still works but is an appendix. The runbook is **`infra/README.md`**;
`make` detects the topology from whether `infra/env/app.env` exists, so `deploy-ps` /
`deploy-logs` / `deploy-down` / `deploy-seed` cover Postgres too on one box. Postgres
binds `127.0.0.1` only (remote psql via `make db-tunnel`), is tuned for 4 GB (plus swap) via env
vars, and every container has a `mem_limit` + capped logs. nginx serves a **static**
`infra/nginx/conf.d/capbase.conf` (the `${DOMAIN}` template is gone; the domain is
hardcoded and `deploy-tls` enforces that it matches `DOMAIN`). Rate limits are per-IP nginx
zones returning 429 — `auth` 10 r/m on `^/api/(auth|admin)/`, `writes` 30 r/m keyed on
**POST only** under `location /`, `general` 10 r/s, plus `crawlers` 30 r/m keyed on the bot
name parsed from the User-Agent (one bucket per crawler across all its IPs; search engines
exempt) — a per-IP limit never caught GPTBot, which spread its load over 54 addresses and
starved the API's DB pool into 504s. Server actions are POSTs to the page URL,
so any new form under `location /` is covered by `writes` with no nginx change. The API is
public **only under `/v1/`** (`location ^~ /v1/` → `api:3000`, its own per-IP `apikeys` zone
10 r/s + 40 burst — never `crawlers`, which would put every `curl`/`python-requests` caller in
one bucket — and `X-Forwarded-For` **overwritten** with `$remote_addr`, since the API keys rate
limits and IP allowlists on it); every other API route stays container-to-container.
`location = /unsubscribe` (the digest's one-click unsubscribe, served by the web) has only the
`general` zone: mail providers POST it from a few shared IPs, which `writes`/`crawlers` would drop. Its
throttler is the per-user / per-key backstop (see Backend). **Cloudflare-ready**: `conf.d/cloudflare-realip.conf` (generated by
`make nginx-cloudflare-ips`) takes `$remote_addr` from `CF-Connecting-IP`, but only for a
peer inside a Cloudflare range. Otherwise every visitor behind one edge would share a
rate-limit bucket. It is inert while the record isn't proxied. Key targets:
`deploy-secrets` (generate all credentials), `backup-keygen` (age keypair, run on the
laptop — the VPS only ever holds the public key), `deploy-backup` (dump → verify-restore
→ encrypt → prune → rclone upload to R2/B2 via `infra/backup/rclone.conf`; any failure
alerts through `scripts/notify-failure.sh`) and `deploy-backup-cron`. `deploy-all` builds
SHA-tagged images, takes a `predeploy` backup, then recreates the containers;
`deploy-rollback SHA=…` / `deploy-releases` go back. GlitchTip (`errors.capbase.fyi`) is
an optional overlay: `deploy-glitchtip-init`, `deploy-glitchtip`. App containers run as
`node` (non-root) and every service has a healthcheck. `deploy-restore` (ship a local dump to prod
over SSH), `rotate-admin-password` (the `001-admin-user` seed phase upserts with
`update: {}`, so re-seeding can never rotate), and `deploy-doctor`.

## Lint & tooling

`yarn lint` runs flat-config ESLint per workspace via turbo. There is **no `next lint`**
(removed in Next 16); `apps/web` lints with `eslint .` and ignores `.next/**`. Shared
configs live in `@repo/eslint-config` (`base`/`next-js`/`nest-js` + prettier). The lint
gate is **strict**: every script passes `--max-warnings 0`, so any warning fails the run
(the `only-warn` downgrade plugin was removed — recommended-set problems are real errors).
The `lint` turbo task `dependsOn: ["^build"]` because the type-aware rules need workspace
dependency types (`@repo/db`/`@repo/api` `dist`); run `yarn build` first on a fresh
checkout, or just use `yarn lint` (turbo builds deps for you). `packages/db` is excluded
(Prisma + generated client).

**Prettier: format only what you wrote.** The repo has a Prettier config
(`@repo/eslint-config/prettier-base`), but much existing code is not Prettier-clean and lint
does not enforce it, so `prettier --write` on a whole file (let alone a folder) rewraps
hundreds of untouched lines into the diff. Match the surrounding style by hand instead.

**Building on a fresh checkout** needs `DATABASE_URL` set even with no database:
`@repo/db`'s build runs `prisma generate`, whose `prisma.config.ts` refuses an unset URL
(a dummy like `postgresql://x:x@localhost:5432/x` is enough). `apps/web`'s production build
prerenders against the API; with none running it logs `ECONNREFUSED` from `[data]` getters,
which is expected noise, not a failure.
