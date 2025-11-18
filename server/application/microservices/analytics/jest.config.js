const baseConfig = require('../../jest.config.base.js');

module.exports = {
  ...baseConfig,
  displayName: 'analytics-service',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts'
  ],
  // Analytics service has lower coverage threshold (read-only service)
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};

