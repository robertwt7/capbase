import type { MonitorUpdate } from '@repo/api';
const safeHtmlBrand: unique symbol = Symbol('escaped digest rows');
export interface SafeHtml {
  readonly [safeHtmlBrand]: true;
  readonly html: string;
  readonly text: string;
}
export function isSafeHtml(value: unknown): value is SafeHtml {
  return !!value && typeof value === 'object' && safeHtmlBrand in value;
}
const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
/** 0 with no local amount is the undisclosed sentinel (as on the Funding Ladder), never "$0". */
const roundAmount = (r: { amountUsd: number; amountLocal?: number | null; currency?: string }) =>
  r.amountUsd === 0 && r.amountLocal == null ? 'Undisclosed amount' : money(r.amountLocal ?? r.amountUsd, r.currency);
/** The only SafeHtml constructor. Every variable is escaped before it can enter markup. */
export function renderDigestRows(
  items: MonitorUpdate[],
  siteUrl: string,
): SafeHtml {
  const origin = new URL(siteUrl).origin;
  const rows = items.slice(0, 50).map((item) => {
    const link = `${origin}/companies/${encodeURIComponent(item.company.slug)}`;
    const label = item.round
      ? `Newly recorded funding · ${item.round.name} · ${item.round.date} · ${roundAmount(item.round)}`
      : `New match for ${item.search?.name ?? 'saved search'}`;
    return {
      html: `<tr><td style="padding:16px 0;border-bottom:1px solid #ded8cc"><a style="color:#141210" href="${escape(link)}">${escape(item.company.name)}</a><br>${escape(label)}</td></tr>`,
      text: `${item.company.name}\n${label}\n${link}`,
    };
  });
  return {
    [safeHtmlBrand]: true,
    html: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.map((r) => r.html).join('')}</table>`,
    text: rows.map((r) => r.text).join('\n\n'),
  };
}
