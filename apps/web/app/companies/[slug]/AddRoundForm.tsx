'use client';

import { useActionState, useState } from 'react';

import { Button, Card, Field, FormError, Input } from '../../../components/ui';

import { addRoundAction, type RoundFormState } from './actions';

import styles from './profile.module.css';

const initial: RoundFormState = {};

export function AddRoundForm({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addRoundAction, initial);

  if (!open) {
    return (
      <Button
        variant="outline"
        shape="pill"
        size="sm"
        className={styles.addToggle}
        onClick={() => setOpen(true)}
      >
        + Add a funding round
      </Button>
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
    <Card className={styles.addFormWrap}>
      <form className={styles.addForm} action={action}>
        <input type="hidden" name="slug" value={slug} />
        <div className={styles.addRow}>
          <Field label="Round">
            <Input name="name" placeholder="Series A" required />
          </Field>
          <Field label="Date">
            <Input type="date" name="date" required />
          </Field>
        </div>
        <div className={styles.addRow}>
          <Field label="Raise (USD)">
            <Input type="number" name="amountUsd" min={0} required />
          </Field>
          <Field label="Post-money (USD, optional)">
            <Input type="number" name="postMoneyUsd" min={0} />
          </Field>
        </div>
        <Field label="Lead investor (optional)">
          <Input name="lead" placeholder="Sequoia Capital" />
        </Field>

        {state.error ? <FormError>{state.error}</FormError> : null}

        <div className={styles.addActions}>
          <Button variant="primary" size="sm" type="submit" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit round'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
