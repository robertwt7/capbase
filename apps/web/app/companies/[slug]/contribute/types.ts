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

export const TYPE_LABELS: Record<ContributionType, string> = {
  round: 'Funding round',
  investor: 'Investor',
  person: 'Team member',
  acquisition: 'Acquisition',
  exit: 'Exit',
  diversity: 'Diversity data',
};
