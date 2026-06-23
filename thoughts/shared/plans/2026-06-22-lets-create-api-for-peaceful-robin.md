# Capbase NestJS API — crowdsourced data + moderation

## Context

Capbase is an open-source Crunchbase/Pitchbook alternative (TurboRepo monorepo, Yarn 4,
`@repo/*` scope). Today the data is **fake**: all domain types and mock records live in
`apps/web/lib/data.ts`, and `apps/api` is an empty NestJS 11 scaffold (a placeholder
`links` CRUD with in-memory data, no DB, no auth, no validation).

We want real, **crowdsourced** data: anyone with an account can submit companies and
funding details, but nothing is public until an **admin** approves it. Backend and
frontend must **share the same domain types**.

This deliverable builds the **NestJS API + shared types + database** only. The admin
portal UI and switching the web app's data fetching from mock → API are explicit
**next phases** (the shared types created here make both straightforward later).

### Decisions (confirmed with user)
- **DB/ORM:** Prisma + PostgreSQL (Postgres via root `docker-compose.yml`).
- **Moderation model:** *status column per entity*. Every contributable row carries a
  `moderationStatus` (`PENDING|APPROVED|REJECTED`). Public reads filter to `APPROVED`.
- **Auth:** full user accounts + roles. Register/login → JWT; `USER` and `ADMIN` roles;
  RBAC guard protects admin endpoints.
- **Naming:** `Company` already has a domain `status` (Private/Public/Acquired), so the
  moderation flag is named **`moderationStatus`** everywhere to avoid collision.

---

## Architecture overview

```
@repo/api (shared, tsc→dist)         apps/api (NestJS)                 Postgres
  domain interfaces  ───────────►  controllers/services  ───►  Prisma  ───► tables
  (Company, FundingRound, …)         DTOs (class-validator)
  Create* input types                Auth (JWT + RolesGuard)
  ReviewStatus, AuthUser             Prisma row → shared-type mappers
```

- **Shared contract = plain TS interfaces** in `@repo/api` (the exact shapes the web app
  already uses). The Prisma-generated client stays internal to `apps/api`; services map
  Prisma rows → shared interfaces. This keeps `@repo/api` dependency-light and avoids
  leaking Prisma/class-validator into the frontend bundle.
- **DTO classes** (with `class-validator` decorators) live in `apps/api` and
  `implements` the shared `Create*` input interfaces.
- `Stage` and `CompanyStatus` stay **string-union types** (identical to the current
  frontend) stored as `String` columns, validated with `@IsIn(...)`. Only `Role` and
  `ReviewStatus` are Prisma enums (internal). This preserves the existing frontend types
  verbatim and minimizes mapping code.
- **Money** (`amountUsd`, `*Usd`) stored as Prisma `BigInt` (Int is 32-bit, too small for
  $24B); mapped to `number` in responses (values are within JS safe-integer range).

---

## Database schema (`apps/api/prisma/schema.prisma`)

Enums: `Role { USER, ADMIN }`, `ReviewStatus { PENDING, APPROVED, REJECTED }`.

Models (every contributable model gets: `moderationStatus ReviewStatus @default(PENDING)`,
`submittedById String?` + relation to `User`, `createdAt`, `updatedAt`):

- **User** — `id`, `email @unique`, `name`, `passwordHash`, `role @default(USER)`,
  `createdAt`. (No moderation fields.)
- **Company** — `slug @unique`, `name`, `domain`, `oneLiner`, `description`, `hq`,
  `founded Int`, `headcount Int`, `industry String[]`, `status` (domain: Private/Public/
  Acquired, String), `stage` (String), `totalRaisedUsd BigInt`, `lastValuationUsd BigInt?`,
  embedded financials (`revenueUsd BigInt?`, `revenueGrowthPct Float?`,
  `grossMarginPct Float?`, `burnMonths Int?`) + `moderationStatus` etc. Relations to all
  children below.
- **FundingRound** — `companyId`, `name`, `date DateTime`, `amountUsd BigInt`,
  `postMoneyUsd BigInt?`, `lead String?`, relation `RoundInvestor[]`.
- **RoundInvestor** — `roundId`, `name`, `lead Boolean`. (Inherits its round's review
  state; no own moderation column.)
- **InvestorHolding** — `companyId`, `name`, `type String`, `firstRound String`,
  `rounds Int`.
- **Person** — `companyId`, `name`, `role`, `since Int`, `prior String?`.
- **AcquisitionDeal** — `companyId`, `target`, `date DateTime`, `amountUsd BigInt?`,
  `rationale`.
- **ExitEvent** — `companyId`, `type String`, `date DateTime`, `valueUsd BigInt?`, `detail`.
- **DiversitySignal** — `companyId`, `label`, `value`, `note`.
- **MarketStat** — `sector @unique`, `dealCount Int`, `totalRaisedUsd BigInt`,
  `medianValuationUsd BigInt`, `trendPct Float`. (Seeded/aggregate; not user-contributed
  for now — no moderation column.)

> Edits-to-existing rows are out of scope for this cut (status-column model handles
> *creates* cleanly; edit-proposals are a later enhancement). Contributions = new rows.

---

## API surface

**Public (no auth)** — return only `moderationStatus = APPROVED`, mapped to shared types:
- `GET /companies` → `Company[]` (directory: top-level fields only)
- `GET /companies/:slug` → `Company` with **approved** children nested
- `GET /market/stats` → `MarketStat[]`, `GET /market/totals` → totals

**Auth:**
- `POST /auth/register` → create `USER`, return JWT
- `POST /auth/login` → JWT
- `GET /auth/me` → current user (JwtAuthGuard)

**Contributions (JwtAuthGuard — any logged-in user)** — create row with
`moderationStatus=PENDING`, `submittedById=current user`:
- `POST /companies` (new company)
- `POST /companies/:slug/rounds | /people | /investors | /acquisitions | /exits | /diversity`

**Admin moderation (`JwtAuthGuard` + `RolesGuard` → `@Roles('ADMIN')`):**
- `GET /admin/submissions?status=PENDING` → combined pending feed (counts + items per type)
- Per-type approve/reject: `PATCH /admin/companies/:id/moderation { status }` and the same
  pattern for `rounds`, `people`, `investors`, `acquisitions`, `exits`, `diversity`.

---

## Implementation steps

1. **Shared types — `packages/api`.** Replace the `links` boilerplate `src/entry.ts` with
   domain types. Create `src/companies/*.ts` (and siblings) exporting the **interfaces
   currently in `apps/web/lib/data.ts` verbatim** (`Stage`, `CompanyStatus`, `Company`,
   `FundingRound`, `RoundInvestor`, `Person`, `InvestorHolding`, `AcquisitionDeal`,
   `ExitEvent`, `DiversitySignal`, `MarketStat`, `MarketTotals`) plus new:
   `ReviewStatus`, `CreateCompanyInput`, `CreateFundingRoundInput`, `CreatePersonInput`,
   `CreateInvestorInput`, `CreateAcquisitionInput`, `CreateExitInput`,
   `CreateDiversityInput`, `AuthUser`, `AuthResponse`, `RegisterInput`, `LoginInput`.
   Keep it runtime-dependency-free (drop `@nestjs/mapped-types`). Barrel via `entry.ts`.

2. **Postgres + Prisma.** Add root `docker-compose.yml` (postgres:16, named volume,
   port 5432). In `apps/api`: add `prisma` (dev) + `@prisma/client`, `prisma/schema.prisma`
   (above), `DATABASE_URL` in `apps/api/.env` (+ `.env.example`). Run
   `prisma migrate dev --name init`.

3. **Seed — `apps/api/prisma/seed.ts`.** Port the mock companies + market stats from
   `apps/web/lib/data.ts` into the DB, all `moderationStatus=APPROVED`, so the API serves
   the same data the frontend shows today. Seed one `ADMIN` user (from env) and one demo
   `USER`. Wire `prisma db seed` in `package.json`.

4. **PrismaModule/Service** (`src/prisma/`) — `PrismaService extends PrismaClient`
   (connect on init), exported global module.

5. **Config + bootstrap.** Add `@nestjs/config` (global). In `main.ts` add a global
   `ValidationPipe({ whitelist: true, transform: true })`. Keep CORS.

6. **Auth** (`src/auth/`, `src/users/`). `bcrypt` password hashing; `@nestjs/jwt` +
   `@nestjs/passport` + `passport-jwt`. `JwtStrategy`, `JwtAuthGuard`, `RolesGuard` +
   `@Roles()` decorator, `@CurrentUser()` param decorator. Register/login/me.

7. **Companies module** (`src/companies/`) — public read (approved + nested approved
   children, with Prisma→shared mappers in a `mapper.ts`), contribution POSTs (DTOs
   `implements Create*Input`, set PENDING + submitter).

8. **Market module** (`src/market/`) — read stats + totals.

9. **Admin/moderation** (`src/admin/`) — combined pending feed + per-type approve/reject
   guarded by `RolesGuard`.

10. **App wiring** — `app.module.ts` imports Config, Prisma, Auth, Users, Companies,
    Market, Admin. **Remove the placeholder `links` module/controller/service** in
    `apps/api/src/links/*` (pure scaffold, unrelated to the product).

11. **Share types into web (light touch, stays on mock data).** Add `@repo/api` as a web
    dependency and change `apps/web/lib/data.ts` to **re-export the domain types from
    `@repo/api`** while keeping its existing mock `getCompanies/getCompany`. This fulfills
    "share types" without changing the data source (that swap is the next phase). Verify
    `yarn build` for web still passes.

### Files
- **New:** `docker-compose.yml`; `apps/api/prisma/{schema.prisma,seed.ts}`;
  `apps/api/.env(.example)`; `apps/api/src/{prisma,auth,users,companies,market,admin}/**`;
  `packages/api/src/{companies,...}/**`.
- **Modify:** `packages/api/src/entry.ts`, `packages/api/package.json`;
  `apps/api/package.json`, `apps/api/src/{main.ts,app.module.ts}`;
  `apps/web/lib/data.ts`, `apps/web/package.json`.
- **Delete:** `apps/api/src/links/**`; `packages/api/src/links/**`.

---

## Verification

1. `docker compose up -d postgres` → `yarn workspace @repo/api build` →
   `yarn workspace api prisma migrate dev` → `yarn workspace api prisma db seed`.
2. `yarn workspace api dev` (port 3000).
3. **Public read:** `curl localhost:3000/companies` returns the seeded approved companies;
   `GET /companies/helia` returns nested approved rounds/people/etc.
4. **Crowdsource flow:** `POST /auth/register` → JWT; `POST /companies/helia/rounds` with
   Bearer token → 201, `moderationStatus=PENDING`; confirm it is **absent** from the
   public `GET /companies/helia`.
5. **Moderation:** login seeded admin → `GET /admin/submissions?status=PENDING` shows it →
   `PATCH /admin/rounds/:id/moderation {status:'APPROVED'}` → it now appears in the public
   read. Reject another and confirm it stays hidden.
6. **Validation:** POST with a bad `stage` / missing field → 400.
7. **e2e:** supertest specs in `apps/api/test/` covering auth, a contribution, and an
   approve→visible cycle (`yarn workspace api test:e2e`).
8. **Type sharing:** `yarn build` (turbo) passes for both `@repo/api` and `web` with web
   importing domain types from `@repo/api`.

## Out of scope (next phases)
- Admin portal UI (`apps/web` admin routes or a new `apps/admin`).
- Swapping web's `getCompanies/getCompany` from mock → live API calls.
- Edit-proposals for existing rows; the `apps/jobs` funding-ingestion worker.
