This is a monorepo using TurboRepoJS, all using Typescript. It is an open-source
alternative to Crunchbase and Pitchbook: crowdsourced company + funding data with
admin moderation, plus automated ingestion of public filings.

Workspaces:

- `apps/web` — Next.js 16 frontend (public site + `/admin` moderation portal).
- `apps/api` — NestJS REST API (auth, moderation, public reads).
- `apps/jobs` — NestJS worker that ingests public filings and bulk datasets (SEC
  Form D on a cron; Form C, SBIR, Form S-1, Form ADV + its Schedule D funds, and
  Wikidata by hand).
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
primitives — don't add CSS Module files for new UI. (Two legacy CSS Modules remain for
the not-yet-redesigned `admin` and `(account)` **profile** pages; the `(account)` auth
forms — login/register — now follow the RHF+zod + Tailwind pattern. Back-compat token
aliases `--font-body`/`--page-max`/`--page-pad` exist only for the remaining modules and
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
  `formatCount`, `formatDate`, `signedPct`). Don't format inline.
- The signature element is the **Funding Ladder** (`components/FundingLadder.tsx`):
  rounds as a vertical ledger with bar widths encoding round size. Keep it as the
  one bold element; surrounding sections stay quiet.
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
- **`SectionHeader`**, **`Eyebrow`**, **`Stat`**, **`EmptyState`**, **`PageContainer`** stay
  bespoke Tailwind role components (no shadcn equivalent), as does `FundingLadder`.
- **`Sheet`** (Radix Dialog) backs the small-screen nav drawer in `components/SiteNav.tsx`
  (`PrimaryNav` + `MobileNav`, both setting `aria-current`).
- **`TurnstileField`** — the Cloudflare Turnstile challenge on register and every
  contribution form. Renders nothing without a site key. The key is read **server-side
  per request** (`lib/turnstile.ts`, env `TURNSTILE_SITE_KEY`) and passed down as a prop;
  the token travels through the server action to the API in the `x-turnstile-token`
  header. Tokens are single-use: forms remount the widget (`key`) after every attempt.

**Landmarks:** the root layout owns the skip link and the single `<main id="content">`.
Pages render plain containers (`<div>` / `PageContainer`) — never their own `<main>`.

**Analytics consent:** GA loads only after opt-in (`components/ConsentBanner.tsx`,
`capbase_consent` cookie); with no `NEXT_PUBLIC_GA_ID` there is no banner at all.

**Build new UI from these primitives + Tailwind utilities.** Never re-inline a button,
badge, card, etc. — extend the primitive. Bespoke layout (grids, the Funding Ladder spine)
is just Tailwind utilities in the component/page, no CSS Modules.

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
  strategy filter, sort by size/vintage/name, `?manager=<slug>` scoping. **Sorted by
  size by default** — AngelList-style SPV platforms report tens of thousands of
  near-empty funds and would otherwise own every page. No per-fund page.
- `/investors` — investor directory (URL-driven filters, same pattern as companies);
  `/investors/[slug]` — investor profile: facts, fund assets, portfolio grid, the firm's
  own officers, or an empty state inviting a contribution.
- `/people` — people directory (URL-driven filters, same pattern as companies): search,
  an "at several companies" toggle, sort by roles held or name. **No role filter** —
  3,744 distinct free-text role strings is not a vocabulary. `/people/[slug]` — person
  profile: roles grouped by organisation, each with its kind, year range and citation.
- `/companies/[slug]/history` — public, paginated change timeline for one company
  (what changed, from what to what, who, when). Deliberately ungated: it shows data
  past the `PREVIEW_LIMIT` contribution gate, which is the right trade for an
  open-data project's audit trail.
- `/admin/users` — account list: search, ban/unban (a ban revokes sessions and rejects
  the user's pending queue), make/revoke admin.
- `/admin` — moderation queue (ADMIN only). `/admin/login` signs in via
  `app/api/admin/login` which stores the JWT in an httpOnly `capbase_token` cookie.
  `lib/auth.ts` (`requireAdmin`) gates pages; `lib/admin.ts` + `app/admin/actions.ts`
  (server actions) approve/reject. Keep it strictly monochrome (`admin.module.css`).
  The admin nav is hand-written `<Link>`s in `app/admin/layout.tsx` (Merges shows a pending
  count); the queue itself has no nav link, only the brand link. Only the queue page uses
  `admin.module.css` — `/admin/merges` and `/admin/users` are Tailwind + `components/ui`, so
  copy **`merges/page.tsx`** (header, `FilterLink` pills, `Card` rows, one `<form
  action={fn.bind(null, …)}>` per button) for any new admin page. The web layer does no
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
  `/profile/settings`, `/contribute` and `/companies/[slug]/contribute`. Robots-disallowed,
  `noindex`, `no-referrer`.
- `/report/[type]/[slug]` — the public report form for a company/investor/person profile
  (linked from each profile's footer). Anonymous even when signed in: `lib/reports.ts` sends
  **no** authorization header, only the Turnstile token. Robots-disallowed, `noindex`.
- `/terms`, `/privacy`, `/data`, `/takedown` — the `(legal)` route group: one prose layout
  (`(legal)/layout.tsx`) styles bare `h1/h2/p/ul/a` via descendant selectors, so a page is
  plain semantic HTML plus `metadata` and a `LAST_UPDATED` line. Site-wide constants
  (`SUPPORT_EMAIL`, `SOURCE_URL`, `DATA_LICENSE_URL`) are **hardcoded** in `lib/site.ts`,
  not env. A new indexable static page must be added to `STATIC_PATHS` in `lib/sitemap.ts`
  (the sitemap is route-handler based; there is no `app/sitemap.ts`); a new form route must be
  added to `disallow` in `app/robots.ts`. Footer links live in `COLUMNS` in
  `components/SiteFooter.tsx`.

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

NestJS 11 REST API on port 3000. Auth = JWT + roles (USER/ADMIN), bcrypt. Every
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
`MAX_PENDING_SUBMISSIONS` (30, `@repo/api`) PENDING rows per user → 429; admins are
exempt from both. `TurnstileGuard` (also on `POST /auth/register`) is a no-op without
`TURNSTILE_SECRET` and fails closed when Cloudflare is unreachable. `POST /reports` is the one
other anonymous write: `@UseGuards(TurnstileGuard)` only, no pending cap, nginx `writes` in
front (`src/reports/`; the admin side is a separate `AdminReportsController` on
`admin/reports`). The JWT is only
identity: `JwtStrategy` re-reads the user, so role, ban and `tokenVersion` come from the DB.

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
`Exclude<ReviewableType, 'proposal'> | 'fund'`. Funds are citable without being reviewable —
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
is required and a fund has no company). There is **no per-fund page and no `slug`** — `/funds` is
a directory, and minting ~95k slugs buys no reader anything.

Controlled vocabularies are TS string-literal unions + a `readonly` const array in `@repo/api`
(`domain/company.ts`), stored as plain `String` columns and validated in DTOs with `@IsIn([...])`
— not Prisma enums. `InvestorType` covers `Venture`/`Growth`/`Angel`/`Corporate`/`Private equity`/
`Accelerator`/`Hedge fund`/`Sovereign wealth` — the last three are derived from source *structure*
(Wikidata P31 class, ADV fund-type columns), never guessed from the firm's name.
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

**`FundingRound.kind`** (`Equity | Debt | Grant`, `ROUND_KINDS` in `@repo/api`) says what sort of
capital a round is. Grants — SBIR/STTR awards — are real capital events but not raises, so they are
excluded from `Company.totalRaisedUsd` (the SBIR source writes 0) and from `MarketService`'s deal
count (`AND r."kind" <> 'Grant'`), while still rendering on the Funding Ladder with a mono badge.
The column is ingest-only: it defaults to `Equity` and no contribution form sets it.

## Jobs (apps/jobs)

NestJS worker (port 3002, health endpoint) with seven pluggable `IngestionSource`s
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

The `@nestjs/schedule` cron (`CRON_SCHEDULE`) runs `INGEST_SOURCES` (default
SEC Form D only — every other source is a snapshot, run by hand). Cron and `backfill.ts`
share a Postgres advisory lock (`ingest/ingest-lock.ts`, a dedicated `pg` client because
advisory locks are per-session): a cron tick skips while a backfill runs, and a backfill
exits 75 while the cron runs. Failed ingests are reported to GlitchTip. Backfills:
`make ingest DAYS=N LIMIT=N SOURCE=all|SEC_EDGAR|WIKIDATA|SEC_ADV|SEC_ADV_FUNDS|SEC_FORM_C|SBIR|SEC_S1`
(→ `node dist/backfill [days] [limit] [source]`), plus `make ingest-investors`
(ADV + Wikidata firms), `make ingest-funds` (ADV Schedule D) and `make ingest-all`
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
different firms).

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

`make backfill-citations` (`src/backfill-citations.ts`, the last step of `ingest-all`)
mints `Source`/`Citation` rows for the whole corpus with **no network access** — the URLs
are constructed from stored identifiers via `sources/sec-edgar/edgar.urls.ts`,
`sources/sbir/sbir.urls.ts`, `sources/sec-s1/s1.urls.ts` and
`sources/wikidata/wikidata.urls.ts` (CIK + accession → the Form D archive path, QID →
the Wikidata page, CRD → the IAPD firm summary, EDGAR file number → the Reg CF offering,
CIK → a filer's Form C / S-1 history). SBIR has no derivable per-award page, so those
rows cite the **dataset itself** (`sourceType: 'Government dataset'`, rendered `[GOV]`)
with the contract number as the reference. Idempotent, so re-run it after each
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
**POST only** under `location /`, `general` 30 r/s. Server actions are POSTs to the page URL,
so any new form under `location /` is covered by `writes` with no nginx change. The API is
never public (web → api is container-to-container), and there is no app-level throttler. Key targets:
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
