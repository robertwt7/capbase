'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { COMPANY_STATUSES, STAGES } from '@repo/api';

import { createCompanyAction, type CompanyFormState } from './actions';

import styles from './contribute.module.css';

const initial: CompanyFormState = {};

export function CompanyForm() {
  const [state, action, pending] = useActionState(createCompanyAction, initial);

  if (state.success) {
    return (
      <main className={styles.main}>
        <div className={styles.success}>
          <h1 className={styles.title}>Submitted for review</h1>
          <p className={styles.sub}>
            Thanks for contributing. Your company is now pending moderation — it will appear once an
            admin approves it. Contributing has unlocked full company profiles for you.
          </p>
          <div className={styles.successActions}>
            <Link href="/profile" className={styles.primaryBtn}>
              View your contributions
            </Link>
            <Link href="/" className={styles.ghostLink}>
              Back to companies
            </Link>
          </div>
        </div>
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

        <Field name="name" label="Company name" required />
        <Field name="domain" label="Website domain" placeholder="acme.com" required />
        <Field name="oneLiner" label="One-liner" required />

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Description</span>
          <textarea className={styles.textarea} name="description" rows={4} required />
        </label>

        <div className={styles.row}>
          <Field name="hq" label="Headquarters" placeholder="San Francisco, CA" required />
          <Field name="founded" label="Founded (year)" type="number" required />
        </div>

        <div className={styles.row}>
          <Field name="headcount" label="Headcount" type="number" required />
          <Field name="totalRaisedUsd" label="Total raised (USD)" type="number" required />
        </div>

        <Field
          name="industry"
          label="Industries"
          placeholder="Fintech, Payments, Infrastructure"
          required
        />

        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Status</span>
            <select className={styles.input} name="status" defaultValue="Private" required>
              {COMPANY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Stage</span>
            <select className={styles.input} name="stage" defaultValue="Seed" required>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Field
          name="lastValuationUsd"
          label="Last valuation (USD, optional)"
          type="number"
        />

        {state.error ? <p className={styles.error}>{state.error}</p> : null}

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Submitting…' : 'Submit for review'}
        </button>
      </form>
    </main>
  );
}

function Field({
  name,
  label,
  type = 'text',
  placeholder,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.input}
        type={type}
        name={name}
        placeholder={placeholder}
        required={required}
        min={type === 'number' ? 0 : undefined}
      />
    </label>
  );
}
