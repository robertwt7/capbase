'use client';

import { useActionState } from 'react';
import { COMPANY_STATUSES, STAGES } from '@repo/api';

import { Button, Card, Field, FormError, Input, Select, Textarea } from '../../components/ui';

import { createCompanyAction, type CompanyFormState } from './actions';

import styles from './contribute.module.css';

const initial: CompanyFormState = {};

export function CompanyForm() {
  const [state, action, pending] = useActionState(createCompanyAction, initial);

  if (state.success) {
    return (
      <main className={styles.main}>
        <Card emphasis className={styles.success}>
          <h1 className={styles.title}>Submitted for review</h1>
          <p className={styles.sub}>
            Thanks for contributing. Your company is now pending moderation — it will appear once an
            admin approves it. Contributing has unlocked full company profiles for you.
          </p>
          <div className={styles.successActions}>
            <Button variant="primary" shape="pill" href="/profile">
              View your contributions
            </Button>
            <Button variant="ghost" href="/">
              Back to companies
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <form className={styles.form} action={action}>
        <header className={styles.head}>
          <h1 className={styles.title}>Add a company</h1>
          <p className={styles.sub}>
            Submit a private company to the open database. All submissions are reviewed before they
            go live.
          </p>
        </header>

        <Field label="Company name">
          <Input name="name" required />
        </Field>
        <Field label="Website domain">
          <Input name="domain" placeholder="acme.com" required />
        </Field>
        <Field label="One-liner">
          <Input name="oneLiner" required />
        </Field>

        <Field label="Description">
          <Textarea name="description" rows={4} required />
        </Field>

        <div className={styles.row}>
          <Field label="Headquarters">
            <Input name="hq" placeholder="San Francisco, CA" required />
          </Field>
          <Field label="Founded (year)">
            <Input name="founded" type="number" min={0} required />
          </Field>
        </div>

        <div className={styles.row}>
          <Field label="Headcount">
            <Input name="headcount" type="number" min={0} required />
          </Field>
          <Field label="Total raised (USD)">
            <Input name="totalRaisedUsd" type="number" min={0} required />
          </Field>
        </div>

        <Field label="Industries">
          <Input name="industry" placeholder="Fintech, Payments, Infrastructure" required />
        </Field>

        <div className={styles.row}>
          <Field label="Status">
            <Select name="status" defaultValue="Private" required>
              {COMPANY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stage">
            <Select name="stage" defaultValue="Seed" required>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Last valuation (USD, optional)">
          <Input name="lastValuationUsd" type="number" min={0} />
        </Field>

        {state.error ? <FormError>{state.error}</FormError> : null}

        <Button variant="primary" block type="submit" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit for review'}
        </Button>
      </form>
    </main>
  );
}
