import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_CONTRIBUTION_WINDOW_DAYS,
  DEFAULT_GATE_POLICY,
  FIELD_REGISTRY,
  GATED_ENTITIES,
  GATED_SECTION_KEYS,
  SECTION_REGISTRY,
  defaultFieldPolicy,
  defaultSectionPolicy,
  fieldInfo,
  isGatedEntity,
  isGatedField,
  isGatedSection,
  resolveGatePolicy,
  validateFieldPolicy,
  validateSectionPolicy,
  validateWindowDays,
  type AdminVisibilityResponse,
  type FieldPolicy,
  type GatePolicy,
  type PolicyOverrideMeta,
  type SectionPolicy,
} from '@repo/api';

import { PrismaService } from '../prisma/prisma.service';

/** How long a snapshot is served before one background refresh. Every write
 *  reloads at once; the TTL only bounds staleness across processes. */
export const GATE_POLICY_TTL_MS = 60_000;

/** The `SiteSetting` key of the contribution window. */
export const WINDOW_SETTING = 'contributionWindowDays';

/**
 * The read gate's live policy: the code defaults (`@repo/api` visibility.ts)
 * merged with the admin's overrides. Read synchronously from an in-memory
 * snapshot (`current()`) — a gated read never waits on it — loaded at boot,
 * reloaded on every write, and refreshed in the background once it is older
 * than `GATE_POLICY_TTL_MS`. A failed load keeps the previous snapshot (the
 * defaults, before the first one succeeds).
 */
@Injectable()
export class GatePolicyService implements OnModuleInit {
  private readonly logger = new Logger(GatePolicyService.name);
  private snapshot: GatePolicy = DEFAULT_GATE_POLICY;
  private loadedAt = 0;
  private refreshing: Promise<GatePolicy> | null = null;

  constructor(protected readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload().catch((err: unknown) => this.logger.error(`Gate policy failed to load: ${String(err)}`));
  }

  /** The policy for this request. Never blocks. */
  current(): GatePolicy {
    if (Date.now() - this.loadedAt > GATE_POLICY_TTL_MS && !this.refreshing) {
      void this.reload().catch((err: unknown) => {
        // Back off to the next TTL rather than retrying on every request.
        this.loadedAt = Date.now();
        this.logger.error(`Gate policy refresh failed, keeping the last snapshot: ${String(err)}`);
      });
    }
    return this.snapshot;
  }

  /** Load the overrides now (single-flight). Awaited by every write. */
  reload(): Promise<GatePolicy> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  // --- Admin (`/admin/visibility`) ------------------------------------------

  /** Every setting: its default, its current value and who last changed it. */
  async adminView(): Promise<AdminVisibilityResponse> {
    const [policy, sectionRows, fieldRows, window] = await Promise.all([
      this.reload(),
      this.prisma.gateSectionPolicy.findMany({ select: { section: true, updatedAt: true, updatedById: true } }),
      this.prisma.gateFieldPolicy.findMany({ select: { entity: true, field: true, updatedAt: true, updatedById: true } }),
      this.prisma.siteSetting.findUnique({ where: { key: WINDOW_SETTING }, select: { updatedAt: true, updatedById: true } }),
    ]);
    const ids = [...new Set([...sectionRows, ...fieldRows, ...(window ? [window] : [])].map((r) => r.updatedById))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })
      : [];
    const emails = new Map(users.map((u) => [u.id, u.email]));
    const meta = (row: { updatedAt: Date; updatedById: string } | undefined | null): PolicyOverrideMeta | null =>
      row ? { updatedAt: row.updatedAt.toISOString(), updatedBy: emails.get(row.updatedById) ?? null } : null;
    const sectionMeta = new Map(sectionRows.map((r) => [r.section, r]));
    const fieldMeta = new Map(fieldRows.map((r) => [`${r.entity}.${r.field}`, r]));

    return {
      sections: GATED_SECTION_KEYS.map((section) => {
        const spec = SECTION_REGISTRY[section];
        return {
          section,
          entity: spec.entity,
          label: spec.label,
          kind: spec.kind,
          default: defaultSectionPolicy(section),
          current: policy.sections[section],
          // A stored row the resolver dropped (logged at load) still names
          // who wrote it, while `current` falls back to the default.
          override: meta(sectionMeta.get(section)),
        };
      }),
      fields: GATED_ENTITIES.flatMap((entity) =>
        Object.keys(FIELD_REGISTRY[entity]).map((field) => {
          const info = fieldInfo(entity, field)!;
          return {
            entity,
            field,
            label: info.label,
            filter: info.filter,
            sort: info.sort,
            default: defaultFieldPolicy(entity, field),
            current: policy.fields[entity][field]!,
            override: meta(fieldMeta.get(`${entity}.${field}`)),
          };
        }),
      ),
      contributionWindowDays: {
        default: DEFAULT_CONTRIBUTION_WINDOW_DAYS,
        current: policy.contributionWindowDays,
        override: meta(window),
      },
    };
  }

  async setSection(section: string, p: SectionPolicy, actor: Actor): Promise<AdminVisibilityResponse> {
    if (!isGatedSection(section)) throw new NotFoundException(`Unknown section "${section}"`);
    const error = validateSectionPolicy(section, p);
    if (error) throw new BadRequestException(error);
    const data = {
      signedOut: p.signedOut,
      signedIn: p.signedIn,
      unlocked: p.unlocked,
      previewRows: p.previewRows,
      partnerAudience: p.partnerAudience,
      updatedById: actor.id,
    };
    await this.prisma.gateSectionPolicy.upsert({ where: { section }, create: { section, ...data }, update: data });
    this.logger.log(`Gate policy: ${actor.email} set ${section} → ${JSON.stringify(p)}`);
    return this.adminView();
  }

  async resetSection(section: string, actor: Actor): Promise<AdminVisibilityResponse> {
    if (!isGatedSection(section)) throw new NotFoundException(`Unknown section "${section}"`);
    await this.prisma.gateSectionPolicy.deleteMany({ where: { section } });
    this.logger.log(`Gate policy: ${actor.email} reset ${section} to its default`);
    return this.adminView();
  }

  async setField(entity: string, field: string, p: FieldPolicy, actor: Actor): Promise<AdminVisibilityResponse> {
    if (!isGatedEntity(entity) || !isGatedField(entity, field)) {
      throw new NotFoundException(`Unknown field "${entity}.${field}"`);
    }
    const error = validateFieldPolicy(entity, field, p);
    if (error) throw new BadRequestException(error);
    const data = { audience: p.audience, partnerAudience: p.partnerAudience, updatedById: actor.id };
    await this.prisma.gateFieldPolicy.upsert({
      where: { entity_field: { entity, field } },
      create: { entity, field, ...data },
      update: data,
    });
    this.logger.log(`Gate policy: ${actor.email} set ${entity}.${field} → ${JSON.stringify(p)}`);
    return this.adminView();
  }

  async resetField(entity: string, field: string, actor: Actor): Promise<AdminVisibilityResponse> {
    if (!isGatedEntity(entity) || !isGatedField(entity, field)) {
      throw new NotFoundException(`Unknown field "${entity}.${field}"`);
    }
    await this.prisma.gateFieldPolicy.deleteMany({ where: { entity, field } });
    this.logger.log(`Gate policy: ${actor.email} reset ${entity}.${field} to its default`);
    return this.adminView();
  }

  async setWindow(days: number, actor: Actor): Promise<AdminVisibilityResponse> {
    const error = validateWindowDays(days);
    if (error) throw new BadRequestException(error);
    await this.prisma.siteSetting.upsert({
      where: { key: WINDOW_SETTING },
      create: { key: WINDOW_SETTING, value: days, updatedById: actor.id },
      update: { value: days, updatedById: actor.id },
    });
    this.logger.log(`Gate policy: ${actor.email} set the contribution window → ${days} days`);
    return this.adminView();
  }

  async resetWindow(actor: Actor): Promise<AdminVisibilityResponse> {
    await this.prisma.siteSetting.deleteMany({ where: { key: WINDOW_SETTING } });
    this.logger.log(`Gate policy: ${actor.email} reset the contribution window to its default`);
    return this.adminView();
  }

  private async load(): Promise<GatePolicy> {
    // Three tiny tables, read one after another: one pooled connection, not three.
    const sections = await this.prisma.gateSectionPolicy.findMany();
    const fields = await this.prisma.gateFieldPolicy.findMany();
    const window = await this.prisma.siteSetting.findUnique({ where: { key: WINDOW_SETTING } });
    const { policy, dropped } = resolveGatePolicy({
      sections,
      fields,
      contributionWindowDays: window?.value ?? undefined,
    });
    for (const reason of dropped) this.logger.warn(`Gate policy override ignored — ${reason}`);
    this.snapshot = policy;
    this.loadedAt = Date.now();
    return policy;
  }
}

/** Who is changing the policy: an admin (`RequestUser`). */
type Actor = { id: string; email: string };

/** A fixed policy in place of the service, for unit tests. */
export const staticGatePolicy = (policy: GatePolicy = DEFAULT_GATE_POLICY): GatePolicyService =>
  ({ current: () => policy, reload: async () => policy }) as unknown as GatePolicyService;
