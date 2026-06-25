'use client';

import { useActionState, useState } from 'react';

import { addRoundAction, type RoundFormState } from './actions';

import styles from './profile.module.css';

const initial: RoundFormState = {};

export function AddRoundForm({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addRoundAction, initial);

  if (!open) {
    return (
      <button type="button" className={styles.addToggle} onClick={() => setOpen(true)}>
        + Add a funding round
      </button>
    );
  }

  if (state.success) {
    return (
      <p className={styles.addSuccess}>
        Round submitted for review. It will appear here once an admin approves it.
      </p>
    );
  }

  return (
    <form className={styles.addForm} action={action}>
      <input type="hidden" name="slug" value={slug} />
      <div className={styles.addRow}>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Round</span>
          <input className={styles.addInput} name="name" placeholder="Series A" required />
        </label>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Date</span>
          <input className={styles.addInput} type="date" name="date" required />
        </label>
      </div>
      <div className={styles.addRow}>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Raise (USD)</span>
          <input className={styles.addInput} type="number" name="amountUsd" min={0} required />
        </label>
        <label className={styles.addField}>
          <span className={styles.addLabel}>Post-money (USD, optional)</span>
          <input className={styles.addInput} type="number" name="postMoneyUsd" min={0} />
        </label>
      </div>
      <label className={styles.addField}>
        <span className={styles.addLabel}>Lead investor (optional)</span>
        <input className={styles.addInput} name="lead" placeholder="Sequoia Capital" />
      </label>

      {state.error ? <p className={styles.addError}>{state.error}</p> : null}

      <div className={styles.addActions}>
        <button type="submit" className={styles.addSubmit} disabled={pending}>
          {pending ? 'Submitting…' : 'Submit round'}
        </button>
        <button type="button" className={styles.addCancel} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
