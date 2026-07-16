/** Lowercase kebab-case slug of a name ('company' when nothing survives). */
export function kebab(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'company';
}
