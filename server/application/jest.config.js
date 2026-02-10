/**
 * Jest Configuration for EdForge Microservices
 * 
 * Unit tests only - excludes integration and E2E tests
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/test/integration/',
    '/test/e2e/',
    '\\.integration\\.spec\\.ts$',
    '\\.e2e\\.spec\\.ts$',
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'microservices/**/src/**/*.ts',
    'libs/**/src/**/*.ts',
    // Exclude test files
    '!**/*.spec.ts',
    '!**/*.module.ts',
    '!**/main.ts',
    '!**/index.ts',
    // Exclude files with missing optional dependencies
    '!libs/aws-mocks/src/athena-mock.service.ts',
    '!libs/aws-mocks/src/s3-mock.service.ts',
    '!libs/aws-mocks/src/eventbridge-mock.service.ts',
    '!libs/auth/src/credential-vendor.ts',
    // Exclude test utilities from coverage
    '!libs/test-utils/**/*.ts',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Coverage thresholds - Phase 3 target: 80%
  // Current: ~30% - incrementally increasing as tests are added
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 30,
      lines: 30,
      statements: 30,
    },
    // Per-file thresholds for critical services
    './microservices/identity/src/auth/auth.service.ts': {
      branches: 50,
      functions: 60,
      lines: 60,
      statements: 60,
    },
    './microservices/identity/src/users/users.service.ts': {
      branches: 50,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/auth(.*)$': '<rootDir>/libs/auth/src/$1',
    '^@app/client-factory(.*)$': '<rootDir>/libs/client-factory/src/$1',
    '^@app/common-utils(.*)$': '<rootDir>/libs/common-utils/src/$1',
    '^@app/http-client(.*)$': '<rootDir>/libs/http-client/src/$1',
    '^@app/csv-parser(.*)$': '<rootDir>/libs/csv-parser/src/$1',
    '^@app/cache(.*)$': '<rootDir>/libs/cache/src/$1',
    '^@app/aws-mocks(.*)$': '<rootDir>/libs/aws-mocks/src/$1',
    '^@app/test-utils(.*)$': '<rootDir>/libs/test-utils/src/$1',
    '^@app/events(.*)$': '<rootDir>/libs/events/src/$1',
    '^@app/logger(.*)$': '<rootDir>/libs/logger/src/$1',
    '^@app/exceptions(.*)$': '<rootDir>/libs/exceptions/src/$1',
    '^@app/health(.*)$': '<rootDir>/libs/health/src/$1',
    '^@aibrains/shared-types(.*)$': '<rootDir>/node_modules/@aibrains/shared-types/dist/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 10000,
  verbose: true,
  // Ignore coverage on files with compile errors
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    'athena-mock',
    's3-mock',
    'credential-vendor',
  ],
};
