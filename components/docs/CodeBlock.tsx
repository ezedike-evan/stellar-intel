'use client';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        <span className="rounded bg-bg-sunken px-1.5 py-0.5 text-xs font-medium text-fg-muted dark:text-fg-muted">
          {language}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-1.5 text-fg-muted opacity-0 transition-opacity hover:bg-bg-sunken hover:text-secondary-text group-hover:opacity-100"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-4 w-4 text-status-up" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl border border-border bg-background p-4 text-sm leading-relaxed">
        <code className="text-primary-text">{code}</code>
      </pre>
    </div>
  );
}
