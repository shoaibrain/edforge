/**
 * Jest configuration for @aibrains/shared-types
 *
 * Runs pure-TS unit specs co-located with source (`**\/*.spec.ts`).
 * Zero runtime deps beyond zod; no setup file, no mocks — just ts-jest.
 *
 * Run: `npx jest --config packages/shared-types/jest.config.cjs`
 * or `pnpm --filter @aibrains/shared-types run test` once test script added.
 */
module.exports = {
  rootDir: './src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.test.json' }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
