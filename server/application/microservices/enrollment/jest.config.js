const baseConfig = require('../../jest.config.base.js');

module.exports = {
  ...baseConfig,
  displayName: 'enrollment-service',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts'
  ]
};

