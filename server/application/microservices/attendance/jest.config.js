const baseConfig = require('../../jest.config.base.js');
const path = require('path');

module.exports = {
  ...baseConfig,
  displayName: 'attendance-service',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts'
  ],
  moduleNameMapper: {
    // Pattern: @app/auth/token-vending-machine -> libs/auth/src/token-vending-machine
    '^@app/([^/]+)(/.*)?$': path.resolve(__dirname, '../../libs/$1/src$2'),
    '^@edforge/shared-types$': path.resolve(__dirname, '../../../packages/shared-types/src'),
    '^@edforge/shared-types/(.*)$': path.resolve(__dirname, '../../../packages/shared-types/src/$1')
  }
};

