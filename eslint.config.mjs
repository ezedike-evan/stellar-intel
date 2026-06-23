import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const eslintConfig = defineConfig([
  // Stale `eslint-disable` comments (left behind as the codebase evolved) should
  // not fail CI under --max-warnings 0.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.recommended,
  prettierConfig,
  // Pin the React version AFTER the Next configs so it overrides their
  // `version: 'detect'` — detection is broken under ESLint 10
  // (eslint-plugin-react calls context.getFilename, removed in ESLint 10).
  { settings: { react: { version: '19' } } },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-console': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Stylistic only; the codebase exports config objects/arrays directly.
      'import/no-anonymous-default-export': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/estimatedRates', '**/estimatedRates.ts'],
              message:
                'Estimated rates are banned (#005). Show source: "unavailable" with null fields instead. See lib/stellar/estimatedRates.ts for context.',
            },
          ],
        },
      ],
    },
  },
  // Test files: mocks legitimately use `any` and intentionally-unused fixtures.
  {
    files: ['tests/**', '**/*.{test,spec}.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  // Build/CI scripts run in Node and are dev tooling, not shipped code.
  {
    files: ['scripts/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // React Compiler-era rules (eslint-plugin-react-hooks v6, enabled by Next 16).
  // They flag real but pre-existing patterns; clearing them is a behaviour-risk
  // refactor tracked as separate tech debt, so they are disabled here rather than
  // blocking CI. TODO(#lint): revisit and re-enable rule-by-rule.
  {
    files: ['app/**', 'components/**', 'hooks/**', 'contexts/**'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
