import React from 'react';
import { Globe, BarChart3, Zap } from 'lucide-react';

export const HowItWorks = () => {
  const steps = [
    {
      title: 'Pick your corridor',
      description: 'Choose a destination country and the USDC amount to withdraw.',
      icon: Globe,
    },
    {
      title: 'Compare live quotes',
      description: 'We pull live SEP-38 quotes from every integrated anchor.',
      icon: BarChart3,
    },
    {
      title: 'Execute in one click',
      description: 'Sign once and settle directly on Stellar with Freighter — non-custodial.',
      icon: Zap,
    },
  ];

  return (
    <section className="py-16 sm:py-24" aria-labelledby="how-it-works-heading">
      <h2
        id="how-it-works-heading"
        className="text-center text-2xl font-bold text-primary-text dark:text-primary-text sm:text-3xl"
      >
        How it works
      </h2>

      <div className="relative mt-12 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-0">
        {steps.map(({ title, description, icon: Icon }, index) => (
          <React.Fragment key={index}>
            <div className="flex flex-col items-center text-center sm:flex-1 px-4">
              {/* Icon container */}
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-subtle dark:bg-accent-subtle">
                <Icon className="h-6 w-6 text-accent dark:text-accent" aria-hidden="true" />
              </div>
              {/* Step number badge */}
              <span className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary-text dark:text-secondary-text">
                Step {index + 1}
              </span>
              {/* Title — preserve exact text */}
              <h3 className="mb-2 text-lg font-semibold text-primary-text dark:text-primary-text">
                {title}
              </h3>
              {/* Description — preserve exact text */}
              <p className="text-sm text-secondary-text dark:text-secondary-text">{description}</p>
            </div>
            {index < steps.length - 1 && (
              <div className="hidden sm:block w-8 flex-shrink-0 mt-6">
                <div className="h-px w-full bg-border dark:bg-border" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
};
