const baseConfig = require('../../jest.config.base.js');
const path = require('path');

module.exports = {
  ...baseConfig,
  displayName: 'http-client',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: {
    // Pattern: @app/auth/token-vending-machine -> libs/auth/src/token-vending-machine
    '^@app/([^/]+)(/.*)?$': path.resolve(__dirname, '../../libs/$1/src$2'),
    '^@aibrains/shared-types$': path.resolve(__dirname, '../../node_modules/@aibrains/shared-types/dist'),
    '^@aibrains/shared-types/(.*)$': path.resolve(__dirname, '../../node_modules/@aibrains/shared-types/dist/$1')
  },
  // Libraries don't have setup files
  setupFilesAfterEnv: []
};

