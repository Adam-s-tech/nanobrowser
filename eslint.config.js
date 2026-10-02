import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tailwindcss from 'eslint-plugin-tailwindcss';

export default [
  {
    ignores: [
      'dist/**',
      '.wxt/**',
      '.output/**',
      '**/tailwind.config.ts',
      // Only TypeScript is linted, as with the previous `--ext .ts,.tsx` setup.
      '**/*.{js,mjs,cjs,jsx,mts,cts}',
    ],
  },
  js.configs.recommended,
  react.configs.flat.recommended,
  ...tsPlugin.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  jsxA11y.flatConfigs.recommended,
  ...tailwindcss.configs['flat/recommended'],
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // ESLint 8 didn't report unused eslint-disable comments.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { chrome: 'readonly' },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'import/no-unresolved': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      // typescript-eslint 8 started reporting unused catch bindings; keep the v7 behavior.
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
      // react-hooks 7's recommended preset adds the React Compiler rules; keep the two classic rules.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
