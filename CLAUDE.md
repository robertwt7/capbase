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
the server component refetches. The mock arrays in the file remain ONLY as an offline
fallback if the API is unreachable in local dev — they are illustrative, not real. Domain
types are re-exported from `@repo/api` (single source of truth). Company logos resolve from `domain` through the same-origin proxy
`app/api/logo/[domain]` (DuckDuckGo icons; Clearbit's API is gone) in `components/CompanyLogo.tsx`; the
monogram is always rendered underneath, so a missing logo never leaves an empty chip. The brand
logo is `components/Logo.tsx` (`Logo` lockup, `LogoMark` cap) — never re-draw it inline.

### Routes

- `/` — landing: hero, market tape, a three-step **How it works** (browse free → contribute →
  approved contribution unlocks every profile for `CONTRIBUTION_WINDOW_DAYS`), sector cards, and
  **Popular companies**: a fresh random draw per visit from `GET /companies/featured` (the API
  scores a 120-company pool on saves, named investors, recent rounds and a known valuation,
  caches it 15 min, and shuffles per call). A locked viewer sees the bottom half blurred
  (`CompanyTable`'s `locked` prop) under an "Unlock by contributing accepted data" panel;
  the featured response carries the viewer's `access` (optional JWT, like the detail read) and
  lifts it for unlocked users/admins. The gate rule itself is `UsersService.accessFor` — the one
  definition the profile detail, `/auth/me/contributions` and the featured read all use.
- `/companies/[slug]` — full company profile (funding ladder, investors, people,
  acquisitions, exits, diversity, financials). Missing sections render empty states
  that invite contribution (open-source angle).
- `/funds` — fund directory (URL-driven filters, same pattern as companies): search,
  strategy and status filters, sort by size/vintage/name, `?manager=<slug>` scoping. **Sorted
  by size by default** (`Fund.sizeUsd` = gross assets, else capital closed — the figure the
  row shows) — AngelList-style SPV platforms report tens of thousands of near-empty funds and
  would otherwise own every page. `/funds/[slug]` — fund page (leaf segment, own
  `loading.tsx`): manager, strategy/status, vintage, size/target/hard cap, launch and close
  dates, terms (fee, carry, hurdle, target IRR; `formatPct`), a metrics table and the largest
  LP commitments. `noindex` unless `fundIndexable` (`@repo/api` `indexing.ts`): a commitment,
  a size, a target, a final close or a fee.
- `/investors` — investor directory (URL-driven filters, same pattern as companies);
  `/investors/[slug]` — investor profile: facts, fund assets, funds (linked to their pages),
  **fund commitments** for a limited partner, portfolio grid (the `INVESTOR_PORTFOLIO_PREVIEW`
  largest by capital raised; count and sectors cover the whole portfolio), the firm's people
  (capped at `INVESTOR_PEOPLE_PREVIEW`, "N of M named"), or an empty state inviting a
  contribution. The detail read counts each relation with its own indexed `count()` — never
  Prisma's `_count`, which GROUP BYs the whole child table (~500 ms per profile at this size).
- `/people` — people directory (URL-driven filters, same pattern as companies): search,
  an "at several companies" toggle, sort by roles held or name. **No role filter** —
  3,744 distinct free-text role strings is not a vocabulary. `/people/[slug]` — person
  profile: roles grouped by organisation, each with its kind, year range and citation.
- `/companies/[slug]/history` — public, paginated change timeline for one company
  (what changed, from what to what, who, when). Deliberately ungated: it shows data
  past the `PREVIEW_LIMIT` contribution gate, which is the right trade for an
  open-data project's audit trail. `noindex, follow`, so it never competes with the
  profile in search.
- `/admin/users` — account list: search, ban/unban (a ban revokes sessions and rejects
  the user's pending queue), and one "Make user / contributor / admin" button per other role
  (a downgrade revokes the API keys the new role no longer permits; a ban revokes all).
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
  Users), whose pending counts come from `GET /admin/submissions/count` and `GET
  /admin/merges/count` — bare counts, never the queues themselves, since the layout runs on
  every admin page. The nav is **rendered only for an ADMIN session**, and only then are the
  counts fetched. Signed-out visitors and ordinary users on `/admin/login` see nothing
  admin-shaped. Never link to `/admin` from the public site. **Both queues are
  paged and no admin read may load a whole status**: APPROVED is every ingested row (~255k), and
  loading it ran the API out of heap. Submissions page by cursor (`before` ← `nextCursor`,
  `SUBMISSION_PAGE_SIZE`; nine tables merged on `(createdAt desc, type, id desc)`, so an
  offset would load every row above it from each), merges by page number (`MERGE_PAGE_SIZE`,
  windowed across signals in `MERGE_SIGNALS` order). Every admin page is Tailwind +
  `components/ui` inside `PageContainer` (so it shares the header's left edge), with filter pills
  from `app/admin/FilterLink.tsx`. Copy **`merges/page.tsx`** (header, `FilterLink` pills,
  `Card` rows, one `<form action={fn.bind(null, …)}>` per button) for any new admin page. The
  queue renders each submission as an **open** `Card` (every field visible, no expand; an
  `investorProposal` shows the same field diff as a company proposal and links the firm), ending
  in one form whose Approve/Reject buttons pick the action via `formAction`. The reason is sent
  only on reject. The web layer does no
  per-action auth; the API's `@Roles('ADMIN')` on `AdminController` is the gate.
  `POST /admin/people/:id/suppress|unsuppress` exists in the API; its only web UI is
  Suppress & resolve on a person report (below).
- `/admin/reports` — the "Report an issue" queue, OPEN/RESOLVED/DISMISSED pills, an
  `OPEN (n)` count in the admin nav (the only signal — no email). Each OPEN card is **one**
  `<form>` (note + link inputs) whose buttons pick the server action via `formAction`:
  Resolve, Dismiss, and on an unsuppressed person Suppress & resolve. Resolving is
  bookkeeping only — companies/investors are never hidden by a report.
- `/verify-email?token=` — spends a verification link on a **button press, never on load**
  (mail scanners open every link and would burn the token). Signed-in, unverified, non-admin
  users see `components/VerifyEmailBanner.tsx` (with a "Resend link" button) on `/profile`,
  `/profile/settings`, `/profile/api-keys`, `/contribute` and `/companies/[slug]/contribute`. Robots-disallowed,
  `noindex`, `no-referrer`.
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
self-canonical, any filter collapses to the bare URL. Thin person/investor profiles render
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
`src/mail/templates/README.md`.

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

**The contribution gate (read side).** Anyone can read; a locked viewer gets only the first
`PREVIEW_LIMIT` (2) rows of each company-profile section, and an approved contribution unlocks
every profile for `CONTRIBUTION_WINDOW_DAYS` (30) — both constants in `@repo/api`
`domain/contributions.ts`, which the web copy reads too. The rule lives in **one** place,
`UsersService.accessFor(viewer?)` → `ViewerAccess { unlocked, unlockedUntil }`: anonymous is
locked, an ADMIN or CONTRIBUTOR is unlocked with no query, everyone else is unlocked while their latest
APPROVED row (any reviewable type, proposals included) is inside the window. `unlockedUntil`
is still reported after it lapses so the UI can say when. Every read that needs it calls
`accessFor` — `getCompanyDetail`, `GET /auth/me/contributions`, `GET /companies/featured` —
never a re-derivation.

Gated reads carry access **in-band**: the route sits behind `OptionalJwtAuthGuard` and the
response includes `access` (`CompanyDetailResponse`, `FeaturedCompaniesResponse`), so a page
needs one request and there is no standalone "am I unlocked?" endpoint. **Don't add a guard
for this**: the guards (`JwtAuthGuard`, `OptionalJwtAuthGuard`, `RolesGuard`,
`VerifiedEmailGuard`, `PendingCapGuard`, `TurnstileGuard`) decide whether a request may
proceed, whereas the gate decides how much a request *sees*. Truncate before loading
citations, so a locked viewer never receives a citation for a row they can't see.
Directory rows (`/companies`, featured) are public and never truncated.

**`GET /companies/featured?limit=`** (default 8, max 24) is the landing shop window. There is
no page-view tracking, so popularity is a score over data already held — saves ×5, approved
investor holdings ×3, non-grant rounds ×1 (each capped), +4 for a round in the last 18 months,
+3 for a known valuation — with `domain <> ''` required so every row has a logo. The top
`FEATURED_POOL` (120) ids are cached in-process for 15 min (`loadFeaturedPool`), and each call
draws a fresh Fisher–Yates shuffle; the web fetches it `no-store` so every visit differs. Tune
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
role/ban transaction (`revokeForRole`). The throttler keys a key on `key:<id>` (never
admin-exempt, never skipped as an internal read) and `V1ReadThrottle`/`V1WriteThrottle` size it
by scope from `API_KEY_LIMITS`; the guard and throttler share one key lookup per request.
**OpenAPI**: `setupApiDocs` (`src/v1/docs.ts`, called in `main.ts`) serves Swagger UI at
`/v1/docs` and the document at `/v1/openapi.json`, public, `include: [V1Module]` only. Bodies and
query params come from the DTO classes through the `@nestjs/swagger` CLI plugin (`nest-cli.json`;
`test/swagger-plugin.js` does the same for e2e) — so `apps/api` pins the **same TypeScript as the
hoisted root** (the plugin loads the root copy; two versions crash the transformer). Responses are
described per route with `@ApiOperation`/`@ApiOkResponse`. Guide for callers: `/developers`.

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
  Rejections write nothing; the row never became public.
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
across the whole parallel run; create users with Prisma and mint keys via `ApiKeysService`).

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
when absent — never 0). `FundCommitment` (an LP `Investor` → `Fund`, money in the fund's
currency plus an ECB-converted `amountUsd`) and `FundMetric` (one per fund per as-at date) are
ingest-only and write no revisions; `FundCommitment` has **no** `(fundId, investorId)` unique,
so an investor merge keeps both rows (the `InvestorHolding` rule) and stays reversible.

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
reading a title string. Besides
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
record whose company matches an existing row by domain or normalized name fills
that row's blank fields instead of creating a duplicate (never overwriting
name/stage/status or human-written copy). The same match-and-enrich runs for
investor firms, keyed on domain then `normalizeInvestorName` (which strips legal
suffixes only — "Greylock Partners" and "Greylock Capital Management" are
different firms). Both name keys fold accents first ("Société Générale" → `societe generale`).

**A company name match is scoped by country, and never crosses a registry number.** Identifier
and domain matches are statements about the entity and stay global; the *name* match only lands
on a row whose country is compatible (`countriesCompatible`: equal, or either side null — a UK
"Acme Ltd" never enriches a US "Acme Inc"). And no inferred match (domain or name) may land on a
row that already holds a **different** `COMPANIES_HOUSE` number — Costain Limited 00610201 and
01393773 are two legal entities. Such pairs are left to the merge detector, whose name sweep
applies the same country rule (`sweep(…, { scopeByCountry: true })`); its domain sweep does not.

**Domains are a match key, so they must identify the entity.** `src/util/domain.ts`
classifies a URL host as identifying, social, or platform; sources publish a
`domain` only for the first kind. This is not theoretical: 3,295 ADV filers list a
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
limits and IP allowlists on it); every other API route stays container-to-container. Its
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
