'use client';
import { useState } from 'react';
import type { Sep6FormSchema } from '@/lib/stellar/sep6-form';

export interface Sep6KycFormProps {
  schema: Sep6FormSchema;
  onSubmit: (data: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}

export function Sep6KycForm({ schema, onSubmit, onCancel }: Sep6KycFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(schema.fields.map((f) => [f.key, '']))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validate(): boolean {
    const result = schema.schema.safeParse(values);
    if (result.success) {
      setErrors({});
      return true;
    }
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    setErrors(fieldErrors);
    return false;
  }

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {schema.fields.map((field) => {
        const fieldId = `sep6-kyc-${field.key}`;
        const errorId = `${fieldId}-error`;
        const error = errors[field.key];

        return (
          <div key={field.key} className="flex flex-col gap-1">
            <label htmlFor={fieldId} className="text-sm font-medium text-secondary-text">
              {field.label}
              {field.required && (
                <span className="ml-1 text-status-down" aria-hidden="true">
                  *
                </span>
              )}
            </label>

            {field.type === 'select' && field.choices ? (
              <select
                id={fieldId}
                value={values[field.key] ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                aria-required={field.required}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={!!error}
                className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent ${
                  error ? 'border-status-down/40 focus:ring-status-down' : 'border-control-border'
                }`}
              >
                <option value="">Select…</option>
                {field.choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={fieldId}
                type="text"
                value={values[field.key] ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                aria-required={field.required}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={!!error}
                className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent ${
                  error ? 'border-status-down/40 focus:ring-status-down' : 'border-control-border'
                }`}
              />
            )}

            {error && (
              <p id={errorId} role="alert" className="text-xs text-status-down">
                {error}
              </p>
            )}
          </div>
        );
      })}

      {submitError && (
        <p role="alert" className="text-sm text-status-down">
          {submitError}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || hasErrors}
          className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 rounded-lg border border-control-border px-4 py-2 text-sm font-medium text-secondary-text transition-colors hover:bg-bg-sunken focus:outline-none focus:ring-2 focus:ring-control-border focus:ring-offset-2 disabled:opacity-50 dark:hover:bg-bg-sunken"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
