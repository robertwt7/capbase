import { IsIn, IsInt, Max, Min } from 'class-validator';
import {
  AUDIENCES,
  CONTRIBUTION_WINDOW_MAX_DAYS,
  PREVIEW_ROWS_MAX,
  SECTION_LEVELS,
  type Audience,
  type SectionLevel,
  type UpdateContributionWindowInput,
  type UpdateFieldPolicyInput,
  type UpdateSectionPolicyInput,
} from '@repo/api';

// Every property is decorated: the global ValidationPipe strips undecorated
// ones. The cross-field rules (levels never decrease, no preview on a block,
// partner audience ≥ audience) are `@repo/api`'s validators, run in the service.

export class UpdateSectionPolicyDto implements UpdateSectionPolicyInput {
  @IsIn([...SECTION_LEVELS])
  signedOut!: SectionLevel;

  @IsIn([...SECTION_LEVELS])
  signedIn!: SectionLevel;

  @IsIn([...SECTION_LEVELS])
  unlocked!: SectionLevel;

  @IsInt()
  @Min(1)
  @Max(PREVIEW_ROWS_MAX)
  previewRows!: number;

  @IsIn([...AUDIENCES])
  partnerAudience!: Audience;
}

export class UpdateFieldPolicyDto implements UpdateFieldPolicyInput {
  @IsIn([...AUDIENCES])
  audience!: Audience;

  @IsIn([...AUDIENCES])
  partnerAudience!: Audience;
}

export class UpdateContributionWindowDto implements UpdateContributionWindowInput {
  @IsInt()
  @Min(1)
  @Max(CONTRIBUTION_WINDOW_MAX_DAYS)
  days!: number;
}
