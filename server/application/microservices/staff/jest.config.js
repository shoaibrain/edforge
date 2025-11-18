const baseConfig = require('../../jest.config.base.js');

module.exports = {
  ...baseConfig,
  displayName: 'staff-service',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts'
  ]
};

