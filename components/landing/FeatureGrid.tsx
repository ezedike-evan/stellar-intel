import React from 'react';

interface FeatureItem {
  step: string;
  title: string;
  body: string;
}

interface FeatureGridProps {
  features: FeatureItem[];
}

export function FeatureGrid({ features }: FeatureGridProps) {
  return (
    <section className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">How it works</h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {features.map(({ step, title, body }) => (
          <div key={step} className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {step}
            </div>
            <div>
              <div className="font-medium text-gray-900 dark:text-white">{title}</div>
              <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
