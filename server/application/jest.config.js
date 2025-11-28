/**
 * Root Jest Configuration for EdForge Application
 * 
 * This configuration handles tests run from root (npm test) that need to discover all test files
 */

module.exports = {
  projects: [
    '<rootDir>/microservices/*/jest.config.js',
    '<rootDir>/libs/*/jest.config.js'
  ],
  collectCoverageFrom: [
    'microservices/**/*.ts',
    'libs/**/*.ts',
    '!**/*.spec.ts',
    '!**/*.test.ts',
    '!**/*.dto.ts',
    '!**/*.entity.ts',
    '!**/main.ts',
    '!**/index.ts'
  ]
};

