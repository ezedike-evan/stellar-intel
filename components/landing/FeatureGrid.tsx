import { Fragment } from 'react';
import { Globe, BarChart3, Zap } from 'lucide-react';

interface FeatureItem {
  step: string;
  title: string;
  body: string;
}

interface FeatureGridProps {
  features: FeatureItem[];
}

const STEP_ICONS = [Globe, BarChart3, Zap];

/**
 * Landing "How it works" explainer — a row of numbered feature steps.
 *
 * Extracted from app/page.tsx so the steps can be sourced as data (#B073).
 * Icons + connecting flow line added per #B082.
 */
export function FeatureGrid({ features }: FeatureGridProps) {
  return (
    <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 dark:bg-gray-800/50 sm:p-6">
      <h2 className="mb-6 text-lg font-semibold text-gray-900 dark:text-white">How it works</h2>
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-0">
        {features.map(({ step, title, body }, index) => {
          const Icon = STEP_ICONS[index % STEP_ICONS.length] ?? Globe;
          return (
            <Fragment key={step}>
              <div className="flex flex-col items-center px-2 text-center sm:flex-1 sm:px-4">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
                  <Icon className="h-6 w-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                </div>
                <span className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Step {step}
                </span>
                <div className="font-medium text-gray-900 dark:text-white">{title}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{body}</div>
              </div>
              {index < features.length - 1 && (
                <div className="mt-6 hidden w-8 shrink-0 sm:block">
                  <div className="h-px w-full bg-gray-200 dark:bg-gray-700" />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
