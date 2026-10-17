import type {
  CompanyStatus,
  CompanyType,
  ExitType,
  FundStatus,
  FundStrategy,
  IdentifierScheme,
  InvestorType,
  OperatingStatus,
  RoleKind,
  RoundKind,
  Sector,
  Stage,
} from '@repo/api';

/**
 * An external identifier a source knows *structurally* — a CIK it read off a
 * filing header, a QID it queried by. Never one inferred from a name: a wrong
 * identifier in the crosswalk joins two unrelated entities.
 */
export interface SourceIdentifier {
  scheme: IdentifierScheme;
  /** Raw as published; the writer normalizes and validates before storing. */
  value: string;
}

/**
 * A reference to an investor firm by the source's own id — how a source that
 * publishes id-keyed edges (fund → manager, deal → investor, LP → fund) points
 * at a firm it contributed earlier, possibly in an earlier run.
 *
 * Resolved by provenance key (`${source}:${externalId}`) first, then by
 * `identifier`: a firm the source MATCHED to an existing row rather than
 * creating has no provenance key of its own, but it does carry the source's
 * identifier, written when it matched. Never by name.
 */
export interface SourceFirmRef {
  externalId: string;
  identifier?: SourceIdentifier;
}

/** One capital event contributed by a source. */
export interface NormalizedRound {
  /** Stable id of this round within the source (Form D accession, Reg CF file
   *  number, SBIR contract number). */
  externalId: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** The comparable figure — FX-converted when the source publishes another
   *  currency. Every sort, total and bar width reads this. */
  amountUsd: number;
  /** Defaults to 'Equity'. */
  kind?: RoundKind;
  /** ISO 4217 of `amountLocal`. Omitted = USD, and `amountLocal` is ignored. */
  currency?: string;
  /** The amount as published, in `currency`. */
  amountLocal?: number;
  /** The name is a placeholder ("Undisclosed round"), so it must never
   *  replace a name another source recorded. */
  genericName?: boolean;
  /** Firms that took part, by the source's own firm id. Written as
   *  RoundInvestor rows; a firm that does not resolve is skipped and counted. */
  investors?: (SourceFirmRef & { lead?: boolean })[];
}

/** An executive/director/founder attached to a company or an investor firm. */
export interface NormalizedPerson {
  /** Stable within the source, e.g. `${cik}:person:${slug}`. */
  externalId: string;
  name: string;
  role: string;
  /**
   * The role as a controlled value, set ONLY when the source's own vocabulary
   * is closed and structural — Form D's `relationship` enum, Wikidata's
   * P112/P169 property identity. Never derived by reading a free-text title:
   * Form C's signature-block roles are prose and stay null, the same stance
   * `primarySector` takes on Form C's missing industry field.
   */
  kind?: RoleKind | null;
  since: number;
  /** When the role ended, when the source dates it. Null means "no end
   *  recorded", which is not the same as "still there". */
  endYear?: number | null;
  title?: string | null;
  linkedinUrl?: string | null;
  /** Identifiers for the PERSON, not for the role: WIKIDATA, or a licensed
   *  partner's contact id. */
  identifiers?: SourceIdentifier[];
  /**
   * Resolve this human by identifier ONLY — never by an exactly-equal name, and
   * never register the name for later name matches. For a source that publishes
   * a stable per-person id across a corpus where names collide constantly (two
   * different "John Smith"s at two firms): a name merge there would be wrong far
   * more often than right, and would pull a Form D "John Smith" into it too.
   */
  identifierOnly?: boolean;
  /**
   * PRIVATE professional contact details for this role. Stored in the
   * PersonContact table, which no public path reads; never written to a public
   * column (`linkedinUrl` above is the PUBLIC one), never logged, never put in
   * a Revision.
   */
  contact?: { email?: string | null; phone?: string | null; linkedinUrl?: string | null };
}

/** An investor holding a position in the company (not tied to a round). */
export interface NormalizedInvestor {
  /** Identifies this company↔investor holding within the source. */
  externalId: string;
  /** Stable id of the INVESTOR ITSELF within the source (Wikidata QID, ADV CRD).
   *  Distinct from `externalId` above, which identifies the holding. Used to
   *  resolve the holding to a first-class Investor row. */
  investorExternalId?: string;
  /** The firm's identifier as this source wrote it (see SourceFirmRef). When
   *  set, the holding resolves by key or identifier only — never by name. */
  investorIdentifier?: SourceIdentifier;
  name: string;
  type: InvestorType;
  /** 'Undisclosed' when unknown. */
  firstRound: string;
  rounds: number;
  /**
   * Drop this holding unless the firm already exists.
   *
   * S-1 ownership tables name holders with no type signal at all — a row can be
   * a VC fund, a corporate parent, a family trust or a founder — and the rule
   * is that InvestorType comes from source structure, never from a firm's name.
   * So these edges attach to firms the ADV/Wikidata sweeps already typed, and
   * are dropped otherwise.
   */
  onlyIfKnown?: boolean;
}

/** An acquisition the company made. */
export interface NormalizedAcquisition {
  externalId: string;
  target: string;
  /** ISO date — required by the schema; undated deals are dropped upstream. */
  date: string;
  amountUsd?: number | null;
  rationale: string;
}

/** An exit event (IPO / acquisition) for the company itself. */
export interface NormalizedExit {
  externalId: string;
  type: ExitType;
  date: string;
  valueUsd?: number | null;
  detail: string;
}

/**
 * A source-agnostic, normalized record. Each ingestion source (SEC EDGAR,
 * Wikidata; OpenCorporates later) maps its raw data into this shape so the
 * IngestService can upsert it uniformly.
 */
export interface NormalizedRecord {
  /** Provenance tag, stored on the row for idempotent upserts (e.g. SEC_EDGAR). */
  source: string;
  /** Stable id of the company within the source (e.g. SEC CIK, Wikidata QID). */
  companyExternalId: string;

  company: {
    name: string;
    hq: string;
    foundedYear: number;
    industry: string[];
    stage: Stage;
    /** Total capital raised to date, in USD. */
    totalRaisedUsd: number;
    // Optional metadata a richer source may provide.
    domain?: string;
    websiteUrl?: string | null;
    linkedinUrl?: string | null;
    primarySector?: Sector | null;
    oneLiner?: string;
    description?: string;
    headcount?: number;
    /** Defaults to 'Private'. */
    status?: CompanyStatus;
    /** ISO 3166-1 alpha-2, already normalized by the source. Only when the
     *  source states a country structurally — never read off a city name. */
    countryCode?: string | null;
    legalName?: string | null;
    operatingStatus?: OperatingStatus | null;
    companyType?: CompanyType | null;
    /** External identifiers the source read off the document. Matched against
     *  the crosswalk *before* domain and name, because an identifier is a
     *  statement by the publisher about which entity this is, where a domain is
     *  a strong inference and a name a weak one. DOMAIN is not emitted here —
     *  IngestService derives it from the stored column so the platform-host
     *  rules in util/domain.ts stay in one place. */
    identifiers?: SourceIdentifier[];
  };

  /** Every round this record contributes. Plural because a Reg CF issuer runs
   *  several offerings and an SBIR grantee wins many awards — one record per
   *  round would re-run the company upsert per round and let the last one
   *  overwrite totalRaisedUsd. */
  rounds?: NormalizedRound[];
  /**
   * How to treat a round that looks like one another source already recorded
   * for a company this record MATCHED (see `round-dedup.ts`). Absent: no check,
   * every round is written (the historical behaviour of every public source).
   *  - `skip`: do not write the near-duplicate; attach its investors to the
   *    existing round instead.
   *  - `enrich`: as `skip`, and also correct the existing INGESTED round with
   *    this source's facts — its stage name, its date, an amount it lacked —
   *    recording each change in the timeline. A human contribution is never
   *    modified.
   */
  roundDedup?: 'skip' | 'enrich';

  people?: NormalizedPerson[];
  investors?: NormalizedInvestor[];
  acquisitions?: NormalizedAcquisition[];
  exits?: NormalizedExit[];
}

/**
 * An investor firm as an entity in its own right, with no company edge.
 *
 * Sources like SEC Form ADV publish a firm universe without disclosing any
 * portfolio, so these arrive detached — they become Investor rows that a
 * contributor can later attach companies to.
 */
export interface NormalizedInvestorFirm {
  /** Stable id of the firm within the source (ADV CRD number, Wikidata QID). */
  externalId: string;
  name: string;
  legalName?: string | null;
  type: InvestorType;
  hq?: string | null;
  /** Same contract as NormalizedRecord['company'].countryCode. */
  countryCode?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  /** Match key and logo source. Sources MUST leave this null when the website's
   *  host belongs to a platform (medium.com, crunchbase.com, …) rather than the
   *  firm — see util/domain.ts. */
  domain?: string | null;
  description?: string | null;
  crdNumber?: string | null;
  cikNumber?: string | null;
  /** Number of private funds the firm reports. */
  fundCount?: number | null;
  /** Gross assets across those funds, USD. */
  assetsUsd?: number | null;
  foundedYear?: number | null;
  /** Same contract as NormalizedRecord['company'].identifiers. */
  identifiers?: SourceIdentifier[];
  /** Officers of the firm itself — the investor half of the person join. Same
   *  shape as a company's people; the resulting role row carries `investorId`
   *  instead of `companyId`. */
  people?: NormalizedPerson[];
}

/** One private fund contributed by a source. */
export interface NormalizedFund {
  /** Stable id of the fund within the source: the SEC private fund id
   *  (805-…) for Form ADV, the fund's filer CIK for Form D. */
  externalId: string;
  name: string;
  /**
   * CRD of the managing firm, when the source knows it structurally.
   *
   * Form ADV does (Schedule D is filed BY the manager). Form D does not — its
   * related persons are the GP's individuals, never the firm — so a Form D fund
   * leaves this null and resolves its manager by matching an existing Fund row
   * on name. A fund that resolves neither way is dropped, not guessed at.
   */
  managerCrd?: string | null;
  strategy?: FundStrategy | null;
  vintageYear?: number | null;
  /** Null when the offering is indefinite; never 0 for "unknown". */
  targetUsd?: number | null;
  closedUsd?: number | null;
  grossAssetsUsd?: number | null;
  hq?: string | null;
  secFundId?: string | null;
  cikNumber?: string | null;
  /** The manager by the source's own firm id, for a source that publishes its
   *  managers itself (resolved like SourceFirmRef). Either this or
   *  `managerCrd` must resolve, or the fund is dropped. */
  manager?: SourceFirmRef;
  status?: FundStatus | null;
  /** ISO dates. */
  launchDate?: string | null;
  latestCloseDate?: string | null;
  finalCloseDate?: string | null;
  hardCapUsd?: number | null;
  /** Percentages as published (2.0 = 2%). Null when absent or unparseable —
   *  never 0 for "unknown". */
  managementFeePct?: number | null;
  carriedInterestPct?: number | null;
  hurdleRatePct?: number | null;
  targetIrrNetMinPct?: number | null;
  targetIrrNetMaxPct?: number | null;
  targetIrrGrossMinPct?: number | null;
  targetIrrGrossMaxPct?: number | null;
  regionFocus?: string | null;
}

/**
 * A fund as an edge endpoint: the source's own id, plus its name and manager
 * so a fund that MATCHED an existing row (and so has no provenance key of its
 * own) resolves exactly the way `upsertFund` matched it — same manager, same
 * normalized name.
 */
export interface SourceFundRef {
  externalId: string;
  name: string;
  manager: SourceFirmRef;
}

/** One limited partner's commitment to a fund. */
export interface NormalizedFundCommitment {
  /** Stable within the source, e.g. `${fundId}:${firmId}`. */
  externalId: string;
  fund: SourceFundRef;
  investor: SourceFirmRef;
  /** ISO 4217 of `amountLocal`; defaults to USD. */
  currency?: string;
  amountLocal?: number | null;
  /** FX-converted comparable figure; null when undisclosed or unconvertible. */
  amountUsd?: number | null;
}

/** A point-in-time figure for a fund. */
export interface NormalizedFundMetric {
  fund: SourceFundRef;
  /** ISO date. */
  asAt: string;
  dryPowderUsd?: number | null;
  aumUsd?: number | null;
  unrealizedUsd?: number | null;
}

/**
 * One bounded batch from a streaming source. A source yields its dependencies
 * first (firms before the funds they manage, funds before their commitments),
 * and IngestService applies each batch in that field order too.
 */
export interface SourceBatch {
  investors?: NormalizedInvestorFirm[];
  funds?: NormalizedFund[];
  records?: NormalizedRecord[];
  commitments?: NormalizedFundCommitment[];
  metrics?: NormalizedFundMetric[];
}

export const INGESTION_SOURCES = Symbol('INGESTION_SOURCES');

export interface FetchOptions {
  /** How many calendar days back to look (sources without a time axis may ignore it). */
  days: number;
  /** Max records to return. */
  limit: number;
  /** CRDs of investor firms already in the database. A fund-producing source
   *  uses it to discard filings by managers we don't hold, before they cost
   *  any memory. Absent for sources that produce no funds. */
  knownManagerCrds?: ReadonlySet<string>;
  /** Companies House numbers already held as COMPANIES_HOUSE identifiers on
   *  company rows. The bulk register source keeps these regardless of its size
   *  filter, so a grantee or Wikidata company is always enriched. */
  knownCompanyNumbers?: ReadonlySet<string>;
}

/** Contract every ingestion source implements. */
export interface IngestionSource {
  readonly name: string;
  /** Run only when named explicitly (`SOURCE=PARTNER`), never as part of an
   *  "all sources" run — for a licensed snapshot that must be loaded on
   *  purpose. */
  readonly explicitOnly?: boolean;
  fetch(opts: FetchOptions): Promise<NormalizedRecord[]>;
  /** Sources that publish an investor universe implement this too. Keeping it on
   *  the same interface means one DI token and one INGEST_SOURCES env var. */
  fetchInvestors?(opts: FetchOptions): Promise<NormalizedInvestorFirm[]>;
  /**
   * Private funds this source contributes. Called once per run, immediately
   * after `fetch`.
   *
   * SEC_ADV_FUNDS fetches independently. SEC_EDGAR instead *drains* funds its
   * `fetch` collected while walking Form D filings — re-walking the index to
   * find them again would double the rate-limited SEC traffic for filings we
   * already downloaded and parsed. Draining is why the call order is fixed and
   * why a second call returns nothing.
   */
  fetchFunds?(opts: FetchOptions): Promise<NormalizedFund[]>;
  /**
   * For a source too large to materialise (the ~550 MB jobs heap cannot hold a
   * few hundred thousand companies with their rounds): bounded batches, applied
   * and released one at a time. When present, `run()` uses this exclusively and
   * never calls fetch/fetchInvestors/fetchFunds.
   */
  stream?(opts: FetchOptions): AsyncIterable<SourceBatch>;
}
