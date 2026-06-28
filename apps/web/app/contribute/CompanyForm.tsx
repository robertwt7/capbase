'use client';

import { useActionState } from 'react';
import { COMPANY_STATUSES, SECTORS, STAGES } from '@repo/api';

import { Button, Card, Field, FormError, Input, Select, Textarea } from '../../components/ui';
import { CITIES } from '../../lib/cities';

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

        <Field label="Company name" error={state.errors?.name}>
          <Input name="name" aria-invalid={!!state.errors?.name} required />
        </Field>
        <Field label="Website domain" error={state.errors?.domain}>
          <Input
            name="domain"
            placeholder="acme.com"
            aria-invalid={!!state.errors?.domain}
            required
          />
        </Field>
        <Field label="One-liner" error={state.errors?.oneLiner}>
          <Input name="oneLiner" aria-invalid={!!state.errors?.oneLiner} required />
        </Field>

        <Field label="Description" error={state.errors?.description}>
          <Textarea
            name="description"
            rows={4}
            aria-invalid={!!state.errors?.description}
            required
          />
        </Field>

        <div className={styles.row}>
          <Field label="Headquarters" error={state.errors?.hq}>
            <Input
              name="hq"
              list="hq-cities"
              placeholder="San Francisco, CA"
              aria-invalid={!!state.errors?.hq}
              required
            />
          </Field>
          <Field label="Founded (year)" error={state.errors?.founded}>
            <Input
              name="founded"
              type="number"
              min={0}
              aria-invalid={!!state.errors?.founded}
              required
            />
          </Field>
        </div>
        <datalist id="hq-cities">
          {CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <div className={styles.row}>
          <Field label="Headcount" error={state.errors?.headcount}>
            <Input
              name="headcount"
              type="number"
              min={0}
              aria-invalid={!!state.errors?.headcount}
              required
            />
          </Field>
          <Field label="Total raised (USD)" error={state.errors?.totalRaisedUsd}>
            <Input
              name="totalRaisedUsd"
              type="number"
              min={0}
              aria-invalid={!!state.errors?.totalRaisedUsd}
              required
            />
          </Field>
        </div>

        <Field label="Primary sector" error={state.errors?.primarySector}>
          <Select
            name="primarySector"
            defaultValue=""
            aria-invalid={!!state.errors?.primarySector}
            required
          >
            <option value="" disabled>
              Select a sector…
            </option>
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Industries" error={state.errors?.industry}>
          <Input
            name="industry"
            placeholder="Fintech, Payments, Infrastructure"
            aria-invalid={!!state.errors?.industry}
            required
          />
        </Field>

        <div className={styles.row}>
          <Field label="Status" error={state.errors?.status}>
            <Select
              name="status"
              defaultValue="Private"
              aria-invalid={!!state.errors?.status}
              required
            >
              {COMPANY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stage" error={state.errors?.stage}>
            <Select
              name="stage"
              defaultValue="Seed"
              aria-invalid={!!state.errors?.stage}
              required
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Last valuation (USD, optional)" error={state.errors?.lastValuationUsd}>
          <Input
            name="lastValuationUsd"
            type="number"
            min={0}
            aria-invalid={!!state.errors?.lastValuationUsd}
          />
        </Field>

        {state.formError ? <FormError>{state.formError}</FormError> : null}

        <Button variant="primary" block type="submit" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit for review'}
        </Button>
      </form>
    </main>
  );
}
