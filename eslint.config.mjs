import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Backend ESLint — ESLint 9 flat config, typescript-eslint non-type-checked
// recommended (fast; no per-tsconfig wiring). `no-explicit-any` (~650) and
// `no-unused-vars` (~160) are ratchet WARNINGS — surfaced for gradual cleanup,
// not blocking; CI gates on errors only. Genuine bug / bad-practice rules stay
// errors. AdminWeb + generated Ed-Fi models are out of scope (backend-first).
export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/build/**', '**/node_modules/**', '**/cdk.out/**',
      '**/coverage/**', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.d.ts',
      'client/AdminWeb/**',
      'packages/edfi-ts-models/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // Declaration-merging namespaces (e.g. `declare global { namespace
      // Express { interface Request … } }`) are the idiomatic way to augment
      // third-party types — not the banned runtime-namespace pattern.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      // `@ts-ignore` is allowed only with an explanatory description (the few
      // sites suppress real missing-types errors; `@ts-expect-error` would
      // itself error where the underlying error is config-dependent).
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts', '**/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Tests legitimately use require() for dynamic/mock module loading.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
