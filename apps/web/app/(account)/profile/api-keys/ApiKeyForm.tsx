'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { MAX_API_KEY_CIDRS } from '@repo/api';

import {
  Button,
  Card,
  Eyebrow,
  Form,
  FormError,
  SelectField,
  SelectItem,
  TextareaField,
  TextField,
} from '@/components/ui';
import {
  apiKeyFormDefaults,
  apiKeyFormSchema,
  type ApiKeyFormValues,
} from '@/lib/validation/api-key';
import { applyServerErrors } from '@/lib/validation/utils';

import { createApiKeyAction } from './actions';

/** Copies `text`, then says so for a moment. */
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      shape="box"
      size="sm"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

/** A mono block the secret (or a command) sits in, selectable in one click. */
function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-sm border border-line bg-paper px-3 py-2.5 font-mono text-[13px] leading-[1.6] text-ink select-all">
      {children}
    </pre>
  );
}

/** The one and only sight of a new key's secret. */
function TokenReveal({
  token,
  siteUrl,
  onDone,
}: {
  token: string;
  siteUrl: string;
  onDone: () => void;
}) {
  const curl = `curl ${siteUrl}/v1/me \\\n  -H "Authorization: Bearer ${token}"`;
  return (
    <Card emphasis className="p-6" role="status">
      <Eyebrow>New key</Eyebrow>
      <p className="mt-2 font-display text-base font-semibold tracking-tight text-ink">
        This is the only time the key is shown.
      </p>
      <p className="mt-1 text-[14px] text-graphite-700">
        Copy it somewhere safe now. Capbase keeps only a hash, so a lost key can&apos;t be recovered
        — revoke it and create another.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Snippet>{token}</Snippet>
        <div>
          <CopyButton text={token} label="Copy key" />
        </div>
      </div>
      <p className="mt-5 font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        Try it
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <Snippet>{curl}</Snippet>
        <div>
          <CopyButton text={curl.replace('\\\n  ', '')} label="Copy command" />
        </div>
      </div>
      <div className="mt-6 border-t border-line pt-4">
        <Button variant="primary" size="sm" type="button" onClick={onDone}>
          I&apos;ve saved it
        </Button>
      </div>
    </Card>
  );
}

export function ApiKeyForm({
  canMintAdmin,
  siteUrl,
}: {
  /** Admins pick a scope; contributors always mint contributor keys. */
  canMintAdmin: boolean;
  siteUrl: string;
}) {
  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeyFormSchema),
    defaultValues: apiKeyFormDefaults,
    mode: 'onBlur',
  });
  const [formError, setFormError] = useState<string>();
  const [token, setToken] = useState<string>();

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await createApiKeyAction(
      canMintAdmin ? values : { ...values, scope: 'contributor' },
    );
    if (result.ok && result.token) {
      setToken(result.token);
      form.reset(apiKeyFormDefaults);
      return;
    }
    if (!result.ok && result.fieldErrors) applyServerErrors(form.setError, result.fieldErrors);
    if (!result.ok && (result.formError || !result.fieldErrors)) {
      setFormError(result.formError ?? 'Something went wrong. Please try again.');
    }
  });

  if (token) {
    return <TokenReveal token={token} siteUrl={siteUrl} onDone={() => setToken(undefined)} />;
  }

  return (
    <Card className="p-6">
      <h2 className="font-display text-base font-semibold tracking-tight text-ink">Create a key</h2>
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
          <TextField
            control={form.control}
            name="name"
            label="Name"
            placeholder="Data team laptop"
            autoComplete="off"
            description="Only you see it, to tell your keys apart."
          />
          {canMintAdmin ? (
            <SelectField control={form.control} name="scope" label="Scope">
              <SelectItem value="contributor">Contributor — writes wait for review</SelectItem>
              <SelectItem value="admin">Admin — writes publish at once</SelectItem>
            </SelectField>
          ) : null}
          <TextareaField
            control={form.control}
            name="allowedCidrs"
            label="IP allowlist (optional)"
            rows={3}
            placeholder={'203.0.113.7\n198.51.100.0/24'}
            className="font-mono"
            description={`One address or CIDR range per line, up to ${MAX_API_KEY_CIDRS}. Leave empty to allow any address.`}
          />

          {formError ? <FormError>{formError}</FormError> : null}

          <div>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? 'Creating…' : 'Create key'}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}
