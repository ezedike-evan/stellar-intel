// commitlint configuration — Conventional Commits with Stellar Intel scopes.
// Enforced via .github/workflows/commitlint.yml on PRs and a husky commit-msg
// hook locally. Keep scope list in sync with .github/labels.yml (module/*).

/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // type enforcement
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // Stellar Intel scopes — must match a module in the codebase.
    // Empty scope is allowed for repo-wide or cross-cutting changes.
    'scope-enum': [
      2,
      'always',
      [
        'offramp',
        'onramp',
        'intent',
        'router',
        'reputation',
        'oracle',
        'mcp',
        'sdk',
        'api',
        'ui',
        'brand',
        'sep1',
        'sep10',
        'sep24',
        'sep38',
        'freighter',
        'telemetry',
        'ops',
        'deps',
        'release',
      ],
    ],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [1, 'always'],
    'footer-leading-blank': [1, 'always'],
  },
};

export default config;
