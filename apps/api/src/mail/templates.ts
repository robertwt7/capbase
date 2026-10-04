import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every transactional email: its subject and the placeholders its files use.
 * The bodies live in `./templates/<name>.{html,txt}` (see its README).
 * `SUBJECT` is filled by the renderer, so it isn't listed in `vars`.
 */
export const TEMPLATES = {
  'verify-email': { subject: 'Confirm your email for Capbase', vars: ['NAME', 'LINK'] },
  'password-reset': { subject: 'Reset your Capbase password', vars: ['NAME', 'LINK'] },
  welcome: { subject: 'Welcome to Capbase', vars: ['NAME', 'SITE_URL'] },
  'submission-approved': {
    subject: 'Your contribution is live on Capbase',
    vars: ['NAME', 'SUMMARY', 'LINK'],
  },
  'submission-rejected': {
    subject: "Your Capbase contribution wasn't published",
    vars: ['NAME', 'SUMMARY', 'REASON', 'LINK'],
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;
export type TemplateVars<T extends TemplateName> = Record<
  (typeof TEMPLATES)[T]['vars'][number],
  string
>;

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];

const PLACEHOLDER = /\{\{\{\s*([A-Z0-9_]+)\s*\}\}\}/g;
// The build copies the files next to the compiled module (nest-cli.json `assets`),
// so this resolves in both src (jest, ts-node) and dist.
const TEMPLATE_DIR = join(__dirname, 'templates');

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Read a template's two bodies from disk. Throws if either file is missing. */
export function loadTemplate(name: TemplateName): { html: string; text: string } {
  return {
    html: readFileSync(join(TEMPLATE_DIR, `${name}.html`), 'utf8'),
    text: readFileSync(join(TEMPLATE_DIR, `${name}.txt`), 'utf8'),
  };
}

/**
 * Fill `{{{VAR}}}` placeholders. Values are HTML-escaped for the html body only
 * (a user's name is user input). A placeholder with no value throws: a typo in a
 * template must fail the spec, never ship a literal `{{{NAME}}}` to an inbox.
 */
export function fill(source: string, vars: Record<string, string>, html: boolean): string {
  return source.replace(PLACEHOLDER, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`Template placeholder {{{${key}}}} has no value`);
    return html ? escapeHtml(value) : value;
  });
}

/** The placeholders a source uses, for the spec's drift check. */
export function placeholders(source: string): Set<string> {
  return new Set([...source.matchAll(PLACEHOLDER)].map((m) => m[1]!));
}

/** Render both bodies of one template. Callers type `vars` with `TemplateVars<T>`. */
export function render(
  name: TemplateName,
  source: { html: string; text: string },
  vars: Record<string, string>,
): { subject: string; html: string; text: string } {
  const { subject } = TEMPLATES[name];
  const all: Record<string, string> = { ...vars, SUBJECT: subject };
  return { subject, html: fill(source.html, all, true), text: fill(source.text, all, false) };
}
