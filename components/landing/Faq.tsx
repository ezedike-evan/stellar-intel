'use client';

import { useState, useRef, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: `Is this custodial? Do you hold my money?`,
    answer: `No. Stellar Intel never holds user funds, user keys, fiat, or KYC data. You sign every transaction in your own wallet; the anchor takes custody under SEP-24/SEP-6; Stellar enforces atomicity.`,
  },
  {
    question: `What happens if an anchor fails or doesn't pay out?`,
    answer: `The anchor — not Stellar Intel — is the settlement party. We surface that risk before you choose: each anchor carries a reputation score built from real outcomes (fill rate, slippage, settle latency). A failing anchor ranks down and its failures are recorded. If an outcome is wrong, you can file a dispute, which resolves on signed, replayable evidence.`,
  },
  {
    question: `How is this different from a block explorer or a single anchor's app?`,
    answer: `An explorer tells you what settled on-chain. An anchor's own app tells you what that anchor says about itself. Neither answers "did this anchor respond on its endpoints this week, and does its stellar.toml still match what is on-chain" — that is the record we keep, on a five-minute clock, with the scoring method published and small samples labelled as small. The execution path is real and non-custodial, but the record is the half that works without anyone's cooperation.`,
  },
  {
    question: `Why did anchor X not show up in the comparison?`,
    answer: `Most often: the anchor doesn't serve that corridor, or it only exposes a SEP the rate engine doesn't yet quote. Historically SEP-6-only anchors were dropped because the flow was SEP-24-only — SEP-6 support is being added. Failed anchors render as "unavailable" rather than disappearing silently.`,
  },
  {
    question: `Which corridors and anchors are supported?`,
    answer: `See the anchor registry in constants/anchors.ts and the live app. Coverage expands via the anchor onboarding process.`,
  },
  {
    question: `Can an AI agent off-ramp through this?`,
    answer: `Yes — an MCP server exposes pricing/comparison and a user-signed execute path. The agent cannot move funds on its own; every executing call must be signed by the user's wallet.`,
  },
  {
    question: `Is there an SDK?`,
    answer: `A typed client (@stellarintel/sdk) is on the roadmap (v4). Today you can call the HTTP API directly.`,
  },
  {
    question: `How do I contribute?`,
    answer: `Read CONTRIBUTING.md, pick a good-first-issue, and open a PR. The docs/COOKBOOK.md has end-to-end recipes.`,
  },
];

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function toggle(index: number) {
    setOpenIndex((prev) => (prev === index ? null : index));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttonRefs.current[(index + 1) % FAQ_ITEMS.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttonRefs.current[(index - 1 + FAQ_ITEMS.length) % FAQ_ITEMS.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttonRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      buttonRefs.current[FAQ_ITEMS.length - 1]?.focus();
    }
  }

  return (
    <section aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="mb-6 text-xl font-semibold text-primary-text">
        Frequently asked questions
      </h2>
      <dl className="divide-y divide-gray-200 rounded-xl border border-border dark:divide-gray-700">
        {FAQ_ITEMS.map(({ question, answer }, index) => {
          const isOpen = openIndex === index;
          const panelId = `faq-panel-${index}`;
          const headingId = `faq-heading-${index}`;

          return (
            <div key={question}>
              <dt id={headingId}>
                <button
                  ref={(el) => {
                    buttonRefs.current[index] = el;
                  }}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-primary-text hover:bg-bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-bg-sunken/60"
                  onClick={() => toggle(index)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                >
                  <span>{question}</span>
                  <ChevronDown
                    className={`ml-4 h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 dark:text-fg-muted ${isOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              </dt>
              <dd
                id={panelId}
                hidden={!isOpen}
                className="px-5 pb-4 pt-0 text-sm text-secondary-text"
              >
                {answer}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
