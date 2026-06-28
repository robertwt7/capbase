/** Shared monochrome control surface — used by Input, Textarea, and Select so
    every form field shares one border/focus/invalid language. */
export const controlClass =
  'flex w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink ' +
  'font-sans transition-colors outline-none ' +
  'placeholder:text-graphite-400 ' +
  'focus-visible:border-ink ' +
  'aria-[invalid=true]:border-ink aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-ink/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
