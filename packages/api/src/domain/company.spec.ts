import { normalizeDomain } from './company';

describe('normalizeDomain', () => {
  it('reduces a URL or host to the bare lower-case host', () => {
    expect(normalizeDomain('https://www.Example.com/about?x=1')).toBe('example.com');
    expect(normalizeDomain('  WWW.Example.COM ')).toBe('example.com');
    expect(normalizeDomain('http://example.com:8080')).toBe('example.com');
    expect(normalizeDomain('example.com.')).toBe('example.com');
  });

  it('keeps a subdomain other than www', () => {
    expect(normalizeDomain('app.example.com')).toBe('app.example.com');
  });

  it('returns empty for an empty input', () => {
    expect(normalizeDomain('')).toBe('');
  });
});
