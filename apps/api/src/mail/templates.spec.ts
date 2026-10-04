import { describe, it, expect } from '@jest/globals';

import { fill, loadTemplate, placeholders, render, TEMPLATE_NAMES, TEMPLATES } from './templates';

describe('email templates', () => {
  describe.each(TEMPLATE_NAMES)('%s', (name) => {
    const source = loadTemplate(name);
    const vars = [...TEMPLATES[name].vars] as string[];

    it('uses exactly the placeholders the registry declares', () => {
      // The html <title> carries SUBJECT; the text body has no title.
      expect(placeholders(source.html)).toEqual(new Set([...vars, 'SUBJECT']));
      expect(placeholders(source.text)).toEqual(new Set(vars));
    });

    it('leaves no placeholder behind once filled', () => {
      const sample = Object.fromEntries(vars.map((v) => [v, `sample-${v}`]));
      const out = render(name, source, sample);
      expect(out.subject).toBe(TEMPLATES[name].subject);
      expect(out.html).not.toContain('{{{');
      expect(out.text).not.toContain('{{{');
      expect(out.html).toContain(`<title>${TEMPLATES[name].subject}</title>`);
    });
  });

  describe('fill', () => {
    it('HTML-escapes values in html mode', () => {
      expect(fill('<p>{{{NAME}}}</p>', { NAME: `<script>"x"&'y'` }, true)).toBe(
        '<p>&#60;script&#62;&#34;x&#34;&#38;&#39;y&#39;</p>',
      );
    });

    it('inserts values verbatim in text mode', () => {
      expect(fill('Hi {{{NAME}}}', { NAME: '<Ada>' }, false)).toBe('Hi <Ada>');
    });

    it('throws on a placeholder with no value', () => {
      expect(() => fill('Hi {{{NAEM}}}', { NAME: 'Ada' }, false)).toThrow(/NAEM/);
    });
  });
});
