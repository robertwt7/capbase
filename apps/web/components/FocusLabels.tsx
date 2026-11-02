'use client';

import { useId, useState } from 'react';

import { Badge, Button } from '@/components/ui';

/** Labels shown before "Show all". */
const VISIBLE = 8;

/**
 * A wrapping list of reported focus labels. Past `VISIBLE` the rest are
 * rendered but `hidden` (so they are in the server HTML for no-JS readers of
 * the source, but not on screen) until the disclosure opens them. The toggle
 * stays put, so focus never jumps.
 */
export function FocusLabels({ labels }: { labels: string[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const extra = labels.length - VISIBLE;

  return (
    <div className="flex flex-col items-start gap-2">
      <ul id={listId} className="flex flex-wrap gap-2">
        {labels.map((label, i) => (
          <li key={label} hidden={!open && i >= VISIBLE}>
            <Badge variant="box">{label}</Badge>
          </li>
        ))}
      </ul>
      {extra > 0 && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="font-mono text-[12px] text-graphite-500 hover:text-ink"
        >
          {open ? 'Show fewer' : `Show all ${labels.length}`}
        </Button>
      )}
    </div>
  );
}
