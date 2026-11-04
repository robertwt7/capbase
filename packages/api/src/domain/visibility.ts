// The read gate's policy: what each audience may see of every gated profile
// section and every header fact. The code below holds the DEFAULTS; an admin
// overrides them per section / per field from `/admin/visibility`, and the API
// stores only those overrides (`GateSectionPolicy`, `GateFieldPolicy`,
// `SiteSetting`). Everything here is pure: the API resolves the policy once per
// request and enforces it, the web only reads the per-viewer hints the API
// sends (`SectionView`, `maskedUnlock`, `DirectoryPage.locked`).

import type { ViewerAccess } from './contributions';

/** Signed out / signed in without a live contribution / unlocked (an approved
 *  contribution inside the window, or the CONTRIBUTOR role). Admins bypass. */
export const VIEWER_TIERS = ['signedOut', 'signedIn', 'unlocked'] as const;
export type ViewerTier = (typeof VIEWER_TIERS)[number];

/** What a tier gets of a section: nothing, the first `previewRows`, or all. */
export const SECTION_LEVELS = ['hidden', 'preview', 'full'] as const;
export type SectionLevel = (typeof SECTION_LEVELS)[number];

/** A minimum audience: `signedIn` includes contributors. */
export const AUDIENCES = ['everyone', 'signedIn', 'contributors'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** What reveals a withheld row or value: signing in, or contributing. */
export type UnlockBy = 'signIn' | 'contribute';

/** The entities that carry configurable header facts. */
export const GATED_ENTITIES = ['company', 'investor', 'fund'] as const;
export type GatedEntity = (typeof GATED_ENTITIES)[number];

/** The pages a section lives on. */
export type SectionEntity = GatedEntity | 'person';

/** Rows a previewed section shows by default. */
export const DEFAULT_PREVIEW_ROWS = 2;
/** Days an approved contribution keeps a user unlocked, by default. */
export const DEFAULT_CONTRIBUTION_WINDOW_DAYS = 30;
export const PREVIEW_ROWS_MAX = 25;
export const CONTRIBUTION_WINDOW_MAX_DAYS = 365;

export interface SectionPolicy {
  signedOut: SectionLevel;
  signedIn: SectionLevel;
  unlocked: SectionLevel;
  /** 1..PREVIEW_ROWS_MAX — what `preview` means for this section. */
  previewRows: number;
  /** Who sees the partner's rows in this section. */
  partnerAudience: Audience;
}

export interface FieldPolicy {
  /** Who sees the value at all. */
  audience: Audience;
  /** Who sees it when the partner wrote it (never below `audience`). */
  partnerAudience: Audience;
}

export interface GatePolicy {
  sections: Record<GatedSection, SectionPolicy>;
  fields: { [E in GatedEntity]: Record<string, FieldPolicy> };
  contributionWindowDays: number;
}

/** How a section looks to one viewer — computed by the API, read by the web. */
export interface SectionView {
  /** Hidden from every tier: the web renders neither the block nor its stat. */
  disabled: boolean;
  /** What would show this viewer more (rows, or the partner's rows); null when nothing would. */
  unlockBy: UnlockBy | null;
  /** The viewer is an admin and the section is hidden from everyone else. */
  adminOnly: boolean;
}

/** The per-viewer section hints a detail response carries. */
export interface GateView {
  sections: Partial<Record<GatedSection, SectionView>>;
}

// --- Defaults -----------------------------------------------------------------

const level = (signedOut: SectionLevel, signedIn: SectionLevel): SectionPolicy => ({
  signedOut,
  signedIn,
  unlocked: 'full',
  previewRows: DEFAULT_PREVIEW_ROWS,
  partnerAudience: 'signedIn',
});
/** Previewed to everyone. */
const open = () => level('preview', 'preview');
/** Previewed once signed in. */
const members = () => level('hidden', 'preview');
/** Shown only when unlocked. */
const contributors = () => level('hidden', 'hidden');
/** A `members` block: whole once signed in (a block is never previewed). */
const membersBlock = () => level('hidden', 'full');

interface SectionSpec {
  entity: SectionEntity;
  label: string;
  /** `block`: one unit, shown whole or not at all — `preview` is rejected. */
  kind: 'rows' | 'block';
  default: SectionPolicy;
}

/** Every gated section: its page, its label (admin UI), its shape and its default. */
export const SECTION_REGISTRY = {
  companyRounds: { entity: 'company', label: 'Funding rounds', kind: 'rows', default: members() },
  companyDiversity: { entity: 'company', label: 'Diversity', kind: 'rows', default: members() },
  companyAcquisitions: { entity: 'company', label: 'Acquisitions', kind: 'rows', default: members() },
  companyExits: { entity: 'company', label: 'Exits', kind: 'rows', default: members() },
  companyInvestors: { entity: 'company', label: 'Investors', kind: 'rows', default: open() },
  companyPeople: { entity: 'company', label: 'People', kind: 'rows', default: open() },
  companyTechnologies: { entity: 'company', label: 'Technologies', kind: 'rows', default: open() },
  companyApps: { entity: 'company', label: 'Apps', kind: 'rows', default: open() },
  investorPortfolio: { entity: 'investor', label: 'Portfolio', kind: 'rows', default: open() },
  investorPeople: { entity: 'investor', label: 'People', kind: 'rows', default: open() },
  investorFunds: { entity: 'investor', label: 'Funds', kind: 'rows', default: open() },
  investorCommitments: { entity: 'investor', label: 'Fund commitments', kind: 'rows', default: members() },
  // ≤ 2 role rows (manager, LP) kept together: a 1-row preview would split them.
  investorFocus: { entity: 'investor', label: 'Investment focus', kind: 'block', default: membersBlock() },
  fundCommitments: { entity: 'fund', label: 'LP commitments', kind: 'rows', default: members() },
  fundMetrics: { entity: 'fund', label: 'Metrics', kind: 'rows', default: members() },
  fundTerms: { entity: 'fund', label: 'Terms', kind: 'block', default: contributors() },
  fundMandate: { entity: 'fund', label: 'Investment mandate', kind: 'block', default: membersBlock() },
  personRoles: { entity: 'person', label: 'Roles', kind: 'rows', default: open() },
} as const satisfies Record<string, SectionSpec>;

export type GatedSection = keyof typeof SECTION_REGISTRY;
export const GATED_SECTION_KEYS = Object.keys(SECTION_REGISTRY) as GatedSection[];

interface FieldSpec {
  label: string;
  /** The directory filter param that matches on this column. */
  filter?: string;
  /** The directory sort param that orders on this column. */
  sort?: string;
  /** A column only the partner ever writes (fund `status`): below its partner
   *  audience a filter on it is dropped, not narrowed — narrowing would match
   *  nothing. */
  partnerOnlyColumn?: boolean;
  /** Overrides of the field default (`everyone` / partner `signedIn`). */
  default?: Partial<FieldPolicy>;
}

/** Public prose: licensed for display, so the partner's value is shown to everyone. */
const prose = (label: string): FieldSpec => ({ label, default: { partnerAudience: 'everyone' } });

/** Every configurable header fact, per entity. Identity (slug, name, ids) is
 *  never configurable; neither are counts. */
export const FIELD_REGISTRY = {
  company: {
    totalRaisedUsd: { label: 'Total raised', sort: 'raised' },
    lastValuationUsd: { label: 'Last valuation', sort: 'valuation' },
    headcount: { label: 'Headcount' },
    founded: { label: 'Founded' },
    hq: { label: 'Headquarters' },
    legalName: { label: 'Legal name' },
    stage: { label: 'Stage', filter: 'stage' },
    status: { label: 'Status', filter: 'status' },
    operatingStatus: { label: 'Operating status' },
    companyType: { label: 'Company type' },
    primarySector: { label: 'Sector', filter: 'sector' },
    industry: { label: 'Industry' },
    countryCode: { label: 'Country', filter: 'country' },
    domain: { label: 'Domain', filter: 'domain' },
    websiteUrl: { label: 'Website' },
    linkedinUrl: { label: 'LinkedIn' },
    twitterUrl: { label: 'Twitter' },
    oneLiner: prose('One-liner'),
    description: prose('Description'),
  },
  investor: {
    type: { label: 'Type', filter: 'type' },
    legalName: { label: 'Legal name' },
    hq: { label: 'Headquarters' },
    countryCode: { label: 'Country', filter: 'country' },
    websiteUrl: { label: 'Website' },
    linkedinUrl: { label: 'LinkedIn' },
    domain: { label: 'Domain' },
    description: prose('Description'),
    fundCount: { label: 'Funds reported' },
    assetsUsd: { label: 'Fund assets' },
    foundedYear: { label: 'Founded' },
  },
  fund: {
    strategy: { label: 'Strategy', filter: 'strategy' },
    status: { label: 'Status', filter: 'status', partnerOnlyColumn: true },
    vintageYear: { label: 'Vintage', sort: 'vintage' },
    targetUsd: { label: 'Target size' },
    // `?sort=size` orders on `sizeUsd` = gross assets, else capital closed, so
    // it is locked when either is hidden.
    closedUsd: { label: 'Capital closed', sort: 'size' },
    grossAssetsUsd: { label: 'Gross assets', sort: 'size' },
    hq: { label: 'Headquarters' },
    regionFocus: { label: 'Region focus' },
  },
} as const satisfies { [E in GatedEntity]: Record<string, FieldSpec> };

export type GatedField<E extends GatedEntity> = keyof (typeof FIELD_REGISTRY)[E] & string;

const fieldSpec = (entity: GatedEntity, field: string): FieldSpec | undefined =>
  (FIELD_REGISTRY[entity] as Record<string, FieldSpec>)[field];

export const isGatedSection = (key: string): key is GatedSection =>
  Object.prototype.hasOwnProperty.call(SECTION_REGISTRY, key);

export const isGatedEntity = (key: string): key is GatedEntity => (GATED_ENTITIES as readonly string[]).includes(key);

export const isGatedField = (entity: GatedEntity, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(FIELD_REGISTRY[entity], field);

/** The label and directory bindings of a registered field (undefined if not registered). */
export const fieldInfo = (
  entity: GatedEntity,
  field: string,
): { label: string; filter: string | null; sort: string | null; partnerOnlyColumn: boolean } | undefined => {
  if (!isGatedField(entity, field)) return undefined;
  const spec = fieldSpec(entity, field)!;
  return {
    label: spec.label,
    filter: spec.filter ?? null,
    sort: spec.sort ?? null,
    partnerOnlyColumn: spec.partnerOnlyColumn ?? false,
  };
};

/** The label of a directory filter or sort param of `entity` (for a locked
 *  control: "Sign in to filter by stage"), or the param itself if unbound. */
export const directoryParamLabel = (entity: GatedEntity, param: string): string => {
  for (const spec of Object.values(FIELD_REGISTRY[entity]) as FieldSpec[]) {
    if (spec.filter === param || spec.sort === param) return spec.label;
  }
  return param;
};

const DEFAULT_FIELD: FieldPolicy = { audience: 'everyone', partnerAudience: 'signedIn' };

export const defaultSectionPolicy = (section: GatedSection): SectionPolicy => ({
  ...SECTION_REGISTRY[section].default,
});

export const defaultFieldPolicy = (entity: GatedEntity, field: string): FieldPolicy => ({
  ...DEFAULT_FIELD,
  ...(fieldSpec(entity, field)?.default ?? {}),
});

const buildDefaults = (): GatePolicy => ({
  sections: Object.fromEntries(GATED_SECTION_KEYS.map((s) => [s, defaultSectionPolicy(s)])) as GatePolicy['sections'],
  fields: Object.fromEntries(
    GATED_ENTITIES.map((entity) => [
      entity,
      Object.fromEntries(Object.keys(FIELD_REGISTRY[entity]).map((f) => [f, defaultFieldPolicy(entity, f)])),
    ]),
  ) as GatePolicy['fields'],
  contributionWindowDays: DEFAULT_CONTRIBUTION_WINDOW_DAYS,
});

/** The policy with no override — exactly the behaviour before it was configurable. */
export const DEFAULT_GATE_POLICY: GatePolicy = buildDefaults();

// --- Validation ---------------------------------------------------------------

const LEVEL_RANK: Record<SectionLevel, number> = { hidden: 0, preview: 1, full: 2 };
const AUDIENCE_RANK: Record<Audience, number> = { everyone: 0, signedIn: 1, contributors: 2 };
const TIER_RANK: Record<ViewerTier, number> = { signedOut: 0, signedIn: 1, unlocked: 2 };

const isLevel = (v: unknown): v is SectionLevel => (SECTION_LEVELS as readonly unknown[]).includes(v);
const isAudience = (v: unknown): v is Audience => (AUDIENCES as readonly unknown[]).includes(v);

/** An error message, or null when `p` is a valid policy for `section`. */
export function validateSectionPolicy(section: string, p: SectionPolicy): string | null {
  if (!isGatedSection(section)) return `Unknown section "${section}"`;
  for (const tier of VIEWER_TIERS) {
    if (!isLevel(p[tier])) return `${tier} must be one of ${SECTION_LEVELS.join(', ')}`;
  }
  if (!Number.isInteger(p.previewRows) || p.previewRows < 1 || p.previewRows > PREVIEW_ROWS_MAX) {
    return `Preview rows must be a whole number from 1 to ${PREVIEW_ROWS_MAX}`;
  }
  if (!isAudience(p.partnerAudience)) return `Partner audience must be one of ${AUDIENCES.join(', ')}`;
  if (LEVEL_RANK[p.signedOut] > LEVEL_RANK[p.signedIn] || LEVEL_RANK[p.signedIn] > LEVEL_RANK[p.unlocked]) {
    return 'A tier with more access can never see less: signed out ≤ signed in ≤ contributed';
  }
  if (SECTION_REGISTRY[section].kind === 'block' && VIEWER_TIERS.some((t) => p[t] === 'preview')) {
    return `${SECTION_REGISTRY[section].label} is shown whole or not at all: choose hidden or full`;
  }
  return null;
}

/** An error message, or null when `p` is a valid policy for `entity.field`. */
export function validateFieldPolicy(entity: string, field: string, p: FieldPolicy): string | null {
  if (!isGatedEntity(entity) || !isGatedField(entity, field)) return `Unknown field "${entity}.${field}"`;
  if (!isAudience(p.audience)) return `Audience must be one of ${AUDIENCES.join(', ')}`;
  if (!isAudience(p.partnerAudience)) return `Partner audience must be one of ${AUDIENCES.join(', ')}`;
  if (AUDIENCE_RANK[p.partnerAudience] < AUDIENCE_RANK[p.audience]) {
    return "The partner's value can't reach a wider audience than the field itself";
  }
  return null;
}

export function validateWindowDays(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > CONTRIBUTION_WINDOW_MAX_DAYS) {
    return `The window must be a whole number of days from 1 to ${CONTRIBUTION_WINDOW_MAX_DAYS}`;
  }
  return null;
}

// --- Resolution ---------------------------------------------------------------

/** One stored override, as the API reads it (columns are plain strings). */
export interface GatePolicyOverrides {
  sections: ({ section: string } & Record<keyof SectionPolicy, unknown>)[];
  fields: ({ entity: string; field: string } & Record<keyof FieldPolicy, unknown>)[];
  contributionWindowDays?: unknown;
}

/** Defaults merged with the stored overrides. An override with an unknown key
 *  or an invalid value is dropped and reported (the caller logs it), so a bad
 *  row can never widen or break the gate. */
export function resolveGatePolicy(overrides: GatePolicyOverrides): { policy: GatePolicy; dropped: string[] } {
  const policy = buildDefaults();
  const dropped: string[] = [];
  for (const row of overrides.sections) {
    const p = {
      signedOut: row.signedOut,
      signedIn: row.signedIn,
      unlocked: row.unlocked,
      previewRows: row.previewRows,
      partnerAudience: row.partnerAudience,
    } as SectionPolicy;
    const error = validateSectionPolicy(row.section, p);
    if (error) dropped.push(`section ${row.section}: ${error}`);
    else policy.sections[row.section as GatedSection] = p;
  }
  for (const row of overrides.fields) {
    const p = { audience: row.audience, partnerAudience: row.partnerAudience } as FieldPolicy;
    const error = validateFieldPolicy(row.entity, row.field, p);
    if (error) dropped.push(`field ${row.entity}.${row.field}: ${error}`);
    else policy.fields[row.entity as GatedEntity][row.field] = p;
  }
  if (overrides.contributionWindowDays !== undefined) {
    const days = overrides.contributionWindowDays;
    const error = typeof days === 'number' ? validateWindowDays(days) : 'not a number';
    if (error) dropped.push(`contributionWindowDays: ${error}`);
    else policy.contributionWindowDays = days as number;
  }
  return { policy, dropped };
}

// --- Per-viewer resolvers -----------------------------------------------------

export function viewerTier(access: ViewerAccess): ViewerTier {
  if (access.unlocked) return 'unlocked';
  return access.signedIn ? 'signedIn' : 'signedOut';
}

const tierMeets = (tier: ViewerTier, audience: Audience): boolean =>
  audience === 'everyone' || (audience === 'signedIn' ? tier !== 'signedOut' : tier === 'unlocked');

/** Whether this viewer is inside `audience`. Always true for an admin. */
export const meets = (access: ViewerAccess, audience: Audience): boolean =>
  Boolean(access.admin) || tierMeets(viewerTier(access), audience);

const tierLimit = (p: SectionPolicy, tier: ViewerTier): number =>
  p[tier] === 'hidden' ? 0 : p[tier] === 'preview' ? p.previewRows : Infinity;

/** Rows of `section` this viewer may receive: 0, `previewRows`, or Infinity. */
export function sectionLimit(policy: GatePolicy, section: GatedSection, access: ViewerAccess): number {
  if (access.admin) return Infinity;
  return tierLimit(policy.sections[section], viewerTier(access));
}

/** Whether this viewer receives the partner's rows in `section`. */
export const sectionPartnerRows = (policy: GatePolicy, section: GatedSection, access: ViewerAccess): boolean =>
  meets(access, policy.sections[section].partnerAudience);

const sectionDisabled = (p: SectionPolicy): boolean => VIEWER_TIERS.every((t) => p[t] === 'hidden');

const unlockFor = (tier: ViewerTier): UnlockBy => (tier === 'signedIn' ? 'signIn' : 'contribute');

/** The tiers above `tier`, lowest first. */
const tiersAbove = (tier: ViewerTier): ViewerTier[] => VIEWER_TIERS.filter((t) => TIER_RANK[t] > TIER_RANK[tier]);

/** How `section` looks to this viewer. `unlockBy` names the lowest tier above
 *  the viewer that gets more rows or the partner's rows. */
export function sectionView(policy: GatePolicy, section: GatedSection, access: ViewerAccess): SectionView {
  const p = policy.sections[section];
  const disabled = sectionDisabled(p);
  if (access.admin) return { disabled: false, unlockBy: null, adminOnly: disabled };
  if (disabled) return { disabled: true, unlockBy: null, adminOnly: false };
  const tier = viewerTier(access);
  const partnerGain = (t: ViewerTier) =>
    p[t] !== 'hidden' && tierMeets(t, p.partnerAudience) && !tierMeets(tier, p.partnerAudience);
  const above = tiersAbove(tier).find((t) => LEVEL_RANK[p[t]] > LEVEL_RANK[p[tier]] || partnerGain(t));
  return { disabled: false, unlockBy: above ? unlockFor(above) : null, adminOnly: false };
}

/** The section views of one page's sections. */
export function gateView(policy: GatePolicy, entity: SectionEntity, access: ViewerAccess): GateView {
  const sections: GateView['sections'] = {};
  for (const section of GATED_SECTION_KEYS) {
    if (SECTION_REGISTRY[section].entity === entity) sections[section] = sectionView(policy, section, access);
  }
  return { sections };
}

/** A registered field's policy (the default for an unregistered one is never
 *  asked for: unregistered fields keep the partner rule, see `fieldGate`). */
const fieldPolicy = (policy: GatePolicy, entity: GatedEntity, field: string): FieldPolicy | undefined =>
  policy.fields[entity][field];

/**
 * What this viewer may see of `entity.field`: `show`; `hide` (the value, whoever
 * wrote it); or `hidePartner` (only a value the partner wrote). An unregistered
 * field keeps the fixed partner rule (`hidePartner` signed out).
 */
export function fieldGate(
  policy: GatePolicy,
  entity: GatedEntity,
  field: string,
  access: ViewerAccess,
): 'show' | 'hide' | 'hidePartner' {
  const p = fieldPolicy(policy, entity, field);
  if (!p) return meets(access, 'signedIn') ? 'show' : 'hidePartner';
  if (!meets(access, p.audience)) return 'hide';
  return meets(access, p.partnerAudience) ? 'show' : 'hidePartner';
}

/** What reveals a value this viewer can't see: the lowest tier that would see
 *  it. Null when the viewer already sees it. */
export function fieldUnlockBy(
  policy: GatePolicy,
  entity: GatedEntity,
  field: string,
  access: ViewerAccess,
  partnerWritten: boolean,
): UnlockBy | null {
  if (access.admin) return null;
  const p = fieldPolicy(policy, entity, field) ?? { audience: 'everyone', partnerAudience: 'signedIn' };
  const sees = (tier: ViewerTier) =>
    tierMeets(tier, p.audience) && (!partnerWritten || tierMeets(tier, p.partnerAudience));
  const tier = viewerTier(access);
  if (sees(tier)) return null;
  const above = tiersAbove(tier).find(sees);
  return above ? unlockFor(above) : null;
}

/** What reveals the partner's rows of a section (for a row-column mask). */
export function sectionPartnerUnlockBy(
  policy: GatePolicy,
  section: GatedSection,
  access: ViewerAccess,
): UnlockBy | null {
  if (access.admin) return null;
  const audience = policy.sections[section].partnerAudience;
  const tier = viewerTier(access);
  if (tierMeets(tier, audience)) return null;
  const above = tiersAbove(tier).find((t) => tierMeets(t, audience));
  return above ? unlockFor(above) : null;
}

/** "Search engines see" — the signed-out level of a section, for the admin page. */
export function crawlerView(p: SectionPolicy): string {
  const rows = p.signedOut === 'full' ? 'Full' : p.signedOut === 'preview' ? `First ${p.previewRows} rows` : 'Nothing';
  return p.signedOut !== 'hidden' && p.partnerAudience !== 'everyone' ? `${rows} · public rows only` : rows;
}

/** Whether any setting of `entity` needs the viewer's contribution state —
 *  a `contributors` audience on a field (or on the partner rows a directory
 *  card samples). A list read looks the contribution up only then. */
export function needsContributionLookup(policy: GatePolicy, entity: SectionEntity): boolean {
  const fieldsNeed =
    entity !== 'person' &&
    Object.values(policy.fields[entity]).some(
      (p) => p.audience === 'contributors' || p.partnerAudience === 'contributors',
    );
  const cardSection: Partial<Record<SectionEntity, GatedSection>> = {
    investor: 'investorPortfolio',
    person: 'personRoles',
  };
  const section = cardSection[entity];
  return fieldsNeed || (section !== undefined && policy.sections[section].partnerAudience === 'contributors');
}

/** Admin UI: the audience ranks, for disabling a partner option below the audience. */
export const audienceAtLeast = (a: Audience, min: Audience): boolean => AUDIENCE_RANK[a] >= AUDIENCE_RANK[min];

// --- Admin API shapes -----------------------------------------------------------

export interface PolicyOverrideMeta {
  updatedAt: string;
  /** The admin's email; null when the account no longer exists. */
  updatedBy: string | null;
}

export interface AdminSectionPolicyRow {
  section: GatedSection;
  entity: SectionEntity;
  label: string;
  kind: 'rows' | 'block';
  default: SectionPolicy;
  current: SectionPolicy;
  override: PolicyOverrideMeta | null;
}

export interface AdminFieldPolicyRow {
  entity: GatedEntity;
  field: string;
  label: string;
  filter: string | null;
  sort: string | null;
  default: FieldPolicy;
  current: FieldPolicy;
  override: PolicyOverrideMeta | null;
}

/** `GET /admin/visibility`. */
export interface AdminVisibilityResponse {
  sections: AdminSectionPolicyRow[];
  fields: AdminFieldPolicyRow[];
  contributionWindowDays: { default: number; current: number; override: PolicyOverrideMeta | null };
}

export type UpdateSectionPolicyInput = SectionPolicy;
export type UpdateFieldPolicyInput = FieldPolicy;
export interface UpdateContributionWindowInput {
  days: number;
}
