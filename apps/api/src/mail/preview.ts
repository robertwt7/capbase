/**
 * Render every email template with sample values into apps/api/.mail-preview/
 * so they can be checked in a browser. Run with `make mail-preview`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadTemplate, render, TEMPLATE_NAMES, type TemplateName, type TemplateVars } from './templates';

const SITE_URL = 'http://localhost:3001';
// The name carries markup on purpose: the preview shows it arriving escaped.
const NAME = 'Ada <Lovelace>';

const SAMPLES: { [T in TemplateName]: TemplateVars<T> } = {
  'verify-email': { NAME, LINK: `${SITE_URL}/verify-email?token=preview-token` },
  'password-reset': { NAME, LINK: `${SITE_URL}/reset-password?token=preview-token` },
  welcome: { NAME, SITE_URL },
};

const outDir = resolve(__dirname, '../../.mail-preview');
mkdirSync(outDir, { recursive: true });

const rows: string[] = [];
for (const name of TEMPLATE_NAMES) {
  const { subject, html, text } = render(name, loadTemplate(name), SAMPLES[name]);
  writeFileSync(join(outDir, `${name}.html`), html);
  writeFileSync(join(outDir, `${name}.txt`), text);
  rows.push(
    `<li><strong>${name}</strong> — ${subject}: <a href="${name}.html">html</a> · <a href="${name}.txt">text</a></li>`,
  );
}

writeFileSync(
  join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Capbase email previews</title>
<body style="font-family:system-ui,sans-serif;background:#f0ece3;color:#141210;padding:24px">
<h1>Capbase email previews</h1><ul>${rows.join('')}</ul></body>`,
);

console.log(`Wrote ${TEMPLATE_NAMES.length * 2} previews + index.html to ${join(outDir, 'index.html')}`);
