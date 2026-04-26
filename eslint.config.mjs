import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  {
    plugins: { '@typescript-eslint': tseslint },
    languageOptions: { parser: tsParser },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-console': 'warn',
      'no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
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
  // Override default ignores of eslint-config-next.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
