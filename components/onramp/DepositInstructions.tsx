'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { Sep24DepositInstruction } from '@/types';

interface DepositInstructionsProps {
  instructions?: Record<string, Sep24DepositInstruction> | undefined;
  moreInfoUrl?: string | undefined;
  message?: string | undefined;
}

const COPIED_MS = 2000;

/**
 * Where to send the fiat for a deposit, as the anchor describes it: a list of
 * labelled values (a bank number, a reference) each with its own Copy button, an
 * optional note, and an optional link to the anchor's own page.
 *
 * Everything here comes from the anchor, so every string is rendered as text.
 */
export function DepositInstructions({
  instructions,
  moreInfoUrl,
  message,
}: DepositInstructionsProps) {
  const entries = Object.entries(instructions ?? {});
  const hasDetails = entries.length > 0 || Boolean(moreInfoUrl);

  return (
    <div className="border-border rounded-xl border p-4">
      {message && <p className="text-secondary-text mb-3 text-sm">{message}</p>}

      {entries.length > 0 && (
        <dl className="space-y-3">
          {entries.map(([key, instruction]) => (
            <InstructionRow
              key={key}
              label={instruction.description || key}
              value={instruction.value}
            />
          ))}
        </dl>
      )}

      {moreInfoUrl && (
        <a
          href={moreInfoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent focus-visible:ring-accent mt-3 inline-block text-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          {"View full instructions on the anchor's site"}
        </a>
      )}

      {!hasDetails && (
        <p className="text-secondary-text text-sm">
          The anchor will show payment details in its window. Keep it open until you have paid.
        </p>
      )}
    </div>
  );
}

function InstructionRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // No clipboard permission: leave the button as it was rather than claim a copy.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-fg-muted text-xs">{label}</dt>
        <dd className="text-primary-text font-mono text-sm break-all">{value}</dd>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        aria-label={`Copy ${label}`}
        onClick={copy}
      >
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  );
}
