import type { GatedSection, GateView, SectionView } from '@repo/api';

/**
 * How one section of a detail response looks to this viewer — a lookup into
 * the hints the API computed (`gate.sections`), never a re-derivation of the
 * policy. Undefined when the response carries no view for it (the offline
 * mock data).
 */
export const sectionView = (detail: { gate?: GateView } | null | undefined, key: GatedSection): SectionView | undefined =>
  detail?.gate?.sections[key];

/** A section switched off for visitors: render neither its block nor its stat. */
export const isDisabled = (view: SectionView | undefined): boolean => view?.disabled === true;
