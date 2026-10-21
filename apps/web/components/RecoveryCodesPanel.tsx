'use client';

import { useState } from 'react';

import { Button } from '@/components/ui';

/**
 * The one-time reveal of recovery codes: they are in this response and nowhere else (only
 * hashes are stored), so the copy says so and offers both a copy and a download.
 */
export function RecoveryCodesPanel({ codes }: { codes: string[] }) {
  const [status, setStatus] = useState('');
  const text = `Capbase recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setStatus('Copied.');
    } catch {
      setStatus('Copy failed — select the codes and copy them instead.');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'capbase-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Downloaded.');
  };

  return (
    <div className="flex flex-col gap-4 rounded-md border border-ink bg-surface p-5">
      <div>
        <h3 className="font-display text-sm font-semibold text-ink">Save your recovery codes</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-graphite-700">
          If you lose your device, each code signs you in once. Keep them somewhere safe, like a
          password manager. <strong className="font-semibold text-ink">They won’t be shown again.</strong>
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[14px] tracking-[0.04em] text-ink">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={copy}>
          Copy all
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          Download .txt
        </Button>
        <span
          role="status"
          className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-graphite-500"
        >
          {status}
        </span>
      </div>
    </div>
  );
}
