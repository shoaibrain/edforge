/**
 * Jest config for ops scripts under `scripts/`.
 *
 * Scope: scripts/operations/, scripts/cleanup-orphans/, etc. Each
 * script's pure-function helpers can carry a colocated `*.spec.ts`
 * file. The pattern matches the per-area config approach used
 * elsewhere in the repo (server/jest.config.js for lib/, server/
 * application/jest.config.js for microservices).
 *
 * Run via: `npm run test:scripts`
 */
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  rootDir: '.',
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 15000,
};
