// The child entity types a signed-in user can contribute to an existing company.
// Shared by the hub page (tab switcher) and the profile's "Propose a change" menu.

export const CONTRIBUTION_TYPES = [
  'round',
  'investor',
  'person',
  'acquisition',
  'exit',
  'diversity',
] as const;

export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

// Hub tabs: the child-entity forms plus the whole-company edit proposal.
export const HUB_TYPES = [...CONTRIBUTION_TYPES, 'edit'] as const;

export type HubType = (typeof HUB_TYPES)[number];

export const TYPE_LABELS: Record<HubType, string> = {
  round: 'Funding round',
  investor: 'Investor',
  person: 'Team member',
  acquisition: 'Acquisition',
  exit: 'Exit',
  diversity: 'Diversity data',
  edit: 'Edit details',
};
