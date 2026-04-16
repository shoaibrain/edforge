/**
 * CDK / server-side jest config.
 *
 * Scope: infrastructure (`lib/`) and CDK entry (`bin/`) tests only.
 * Application unit tests live under server/application and use their own
 * jest config.
 */
module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  roots: ['<rootDir>/lib', '<rootDir>/bin'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/application/'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000,
};
