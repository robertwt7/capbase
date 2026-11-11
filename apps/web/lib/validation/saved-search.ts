import { z } from 'zod';
import { SAVED_SEARCH_NAME_MAX, SAVED_SEARCH_PARAMS_MAX } from '@repo/api';
export const savedSearchFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give this search a name.')
    .max(SAVED_SEARCH_NAME_MAX, 'Use at most 100 characters.'),
});
export const savedSearchFormDefaults = { name: '' };
export type SavedSearchFormValues = z.infer<typeof savedSearchFormSchema>;
export const saveSearchSchema = savedSearchFormSchema.extend({
  params: z
    .string()
    .max(SAVED_SEARCH_PARAMS_MAX, 'This search is too long to save.'),
});
