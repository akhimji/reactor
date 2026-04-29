// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/.vite/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'packages/game/index.html',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['phaser', 'phaser/*'],
              message: 'Sim is renderer-agnostic. Phaser belongs in @reactor/game only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/game/src/**/*.ts', 'packages/tools/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@reactor/sim/src',
                '@reactor/sim/src/*',
                '@reactor/sim/dist',
                '@reactor/sim/dist/*',
              ],
              message:
                'Import from the @reactor/sim package entry or declared subpath exports only — internals are private (ADR-003).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
);
